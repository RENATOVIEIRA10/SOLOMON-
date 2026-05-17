/**
 * RAG Answer — Streaming variant.
 *
 * Parallels `ask()` from answer.ts but yields tokens as they are generated
 * by the LLM. Consumed by /api/ask/stream (SSE endpoint).
 *
 * Flow (identical to ask() until the LLM call):
 *   embed query -> search pgvector -> enrich -> build context
 *   -> callLLMStream (yields deltas) -> extract citations -> save -> yield final
 */

import { randomUUID } from "node:crypto";

import { semanticSearch, type SearchResult } from "./search";
import { buildContext } from "./context-builder";
import { extractCitations, type Citation } from "./citation";
import { callLLMStream } from "./llm";
import { RAG } from "@/config/constants";
import { expandQueryWithJargon } from "@/config/jargon";
import {
  SYSTEM_PROMPT_TEMPLATE,
  LOW_CONFIDENCE_THRESHOLD,
  detectInsurers,
  resolveInsurerIds,
  structuredSearch,
  loadEnrichment,
  diversifyResults,
  buildUserMessage,
  saveConversation,
  stripSourcesSection,
  type AskOptions,
} from "./answer";

export interface StreamTokenEvent {
  type: "token";
  delta: string;
}
export interface StreamMetaEvent {
  type: "meta";
  model: string;
  conversationId?: string;
  citations: Citation[];
  tokensUsed: number;
  latencyMs: number;
  confidenceScore: number;
  avgSimilarity: number;
  sourceCount: number;
  lowConfidence: boolean;
}
export interface StreamErrorEvent {
  type: "error";
  message: string;
}

export type StreamEvent = StreamTokenEvent | StreamMetaEvent | StreamErrorEvent;

/**
 * Streams the SOLOMON RAG pipeline response as tokens arrive.
 */
export async function* askStream(
  question: string,
  options?: AskOptions
): AsyncGenerator<StreamEvent> {
  const startTime = Date.now();

  try {
    // ---- 1. Search (mirror of ask()) ----
    const mentionedInsurers = detectInsurers(question);
    const expandedQuery = expandQueryWithJargon(question);

    // Slice 3C-c: corpus-routing context for telemetry + preview mode.
    const corpusCtx = {
      insurerNames: mentionedInsurers,
      requestId: randomUUID(),
      question,
      source: "stream" as const,
    };

    let searchResults: SearchResult[] = [];

    if (mentionedInsurers.length > 0) {
      const insurerIds = await resolveInsurerIds(mentionedInsurers);
      const perInsurer = Math.ceil(RAG.topK / mentionedInsurers.length);

      for (const [, ids] of insurerIds) {
        const nameResults: SearchResult[] = [];
        for (const id of ids) {
          const r = await semanticSearch(expandedQuery, {
            ...corpusCtx,
            insurerId: id,
            topK: perInsurer,
          });
          nameResults.push(...r);
        }
        searchResults.push(...nameResults);
      }

      if (searchResults.length === 0) {
        searchResults = await semanticSearch(expandedQuery, {
          ...corpusCtx,
          insurerId: options?.insurerFilter,
          topK: RAG.fetchK,
        });
      }
    } else {
      searchResults = await semanticSearch(expandedQuery, {
        ...corpusCtx,
        insurerId: options?.insurerFilter,
        topK: RAG.fetchK,
      });
    }

    if (searchResults.length === 0) {
      searchResults = await structuredSearch(question, options?.insurerFilter);
    }

    // ---- 2. Enrich + diversify ----
    const enrichment = await loadEnrichment(searchResults);

    if (mentionedInsurers.length === 0) {
      searchResults = diversifyResults(searchResults, enrichment, mentionedInsurers);
    } else if (searchResults.length > RAG.topK) {
      searchResults = searchResults.slice(0, RAG.topK);
    }

    // ---- 3. Build context ----
    const { contextText, sources } = buildContext(searchResults, enrichment);

    // ---- 4. Confidence heuristic ----
    const avgSimilarity =
      searchResults.length > 0
        ? searchResults.reduce((sum, r) => sum + (r.similarity ?? 0), 0) /
          searchResults.length
        : 0;
    const sourceCount = searchResults.length;
    const sourceFactor = Math.min(1, sourceCount / 5);
    const confidenceScore =
      Math.round((avgSimilarity * 0.6 + sourceFactor * 0.4) * 100) / 100;
    const lowConfidence = confidenceScore < LOW_CONFIDENCE_THRESHOLD;

    // ---- 5. Prompt + stream ----
    // Stream path (dashboard SSE). Channel whatsapp suprime FONTES porque o
    // canal injeta citacoes via formatRagResponse — guard defensivo.
    const baseTemplate =
      options?.channel === "whatsapp"
        ? stripSourcesSection(SYSTEM_PROMPT_TEMPLATE)
        : SYSTEM_PROMPT_TEMPLATE;
    const systemPrompt = baseTemplate.replace(
      "{context}",
      contextText || "Nenhum documento encontrado."
    );
    const userMessage = buildUserMessage(question, options?.conversationHistory);

    let fullText = "";
    let model = "unknown";
    let tokensUsed = 0;

    for await (const chunk of callLLMStream(systemPrompt, userMessage)) {
      if (chunk.type === "start") {
        model = chunk.model;
      } else if (chunk.type === "delta") {
        fullText += chunk.text;
        yield { type: "token", delta: chunk.text };
      } else if (chunk.type === "end") {
        model = chunk.model;
        tokensUsed = chunk.tokensUsed;
      }
    }

    // ---- 6. Citations + save ----
    const citations = extractCitations(fullText, sources);

    let conversationId: string | undefined;
    if (options?.brokerId) {
      conversationId = await saveConversation({
        brokerId: options.brokerId,
        channel: options.channel ?? "api",
        message: question,
        response: fullText,
        model,
        tokensUsed,
        latencyMs: Date.now() - startTime,
        sources: citations,
      });
    }

    yield {
      type: "meta",
      model,
      conversationId,
      citations,
      tokensUsed,
      latencyMs: Date.now() - startTime,
      confidenceScore,
      avgSimilarity,
      sourceCount,
      lowConfidence,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro inesperado ao processar.";
    console.error("[rag/stream] error:", err);
    yield { type: "error", message };
  }
}
