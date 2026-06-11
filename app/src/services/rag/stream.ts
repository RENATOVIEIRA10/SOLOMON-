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

import { hybridSearch, type SearchResult } from "./search";
import { buildContext } from "./context-builder";
import { auditCitations, type Citation } from "./citation";
import { callLLMStream } from "./llm";
import { RAG } from "@/config/constants";
import { expandQueryWithJargon } from "@/config/jargon";
import { detectRateIntent, formatRateAnswer, queryRateTable } from "./rate-lookup";
import { detectOutOfDomainQuery, refusalMessageForDomain } from "./domain-guard";
import { detectClaimVerdictIntent, claimGuidanceMessage } from "./claim-guard";
import {
  SYSTEM_PROMPT_TEMPLATE,
  LOW_CONFIDENCE_THRESHOLD,
  detectInsurers,
  resolveInsurerIds,
  questionImpliesOtherInsurers,
  structuredSearch,
  loadEnrichment,
  diversifyResults,
  buildUserMessage,
  saveConversation,
  stripSourcesSection,
  adjustConfidenceForCitationAudit,
  buildRagAnswerWarnings,
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
  citationCoverage: number;
  invalidCitationIndexes: number[];
  answerWarnings: string[];
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
    const compareIntent =
      mentionedInsurers.length === 1 && questionImpliesOtherInsurers(question);
    const expandedQuery = expandQueryWithJargon(question);

    // GRD-03: fronteira de dominio — recusar perguntas fora do escopo vida/pessoas ANTES do retrieval
    const domainCheck = detectOutOfDomainQuery(question);
    if (domainCheck.isOutOfDomain) {
      console.log(`[grd-03] Out-of-domain (stream) bloqueada: domain=${domainCheck.detectedDomain}`);
      const answer = refusalMessageForDomain(domainCheck.detectedDomain);
      let conversationId: string | undefined;
      if (options?.brokerId) {
        conversationId = await saveConversation({ brokerId: options.brokerId, channel: options.channel ?? "api", message: question, response: answer, model: "domain-guard", tokensUsed: 0, latencyMs: Date.now() - startTime, sources: [] });
      }
      yield { type: "token", delta: answer };
      yield { type: "meta", model: "domain-guard", conversationId, citations: [], tokensUsed: 0, latencyMs: Date.now() - startTime, confidenceScore: 1.0, avgSimilarity: 0, sourceCount: 0, lowConfidence: false, citationCoverage: 1, invalidCitationIndexes: [], answerWarnings: [] };
      return;
    }

    // GRD-04 (canal oraculo): veredicto de sinistro sobre evento concreto nao passa pelo
    // post-validation do pre-sinistro.ts — recusar veredicto aqui, por construcao.
    if (detectClaimVerdictIntent(question)) {
      console.log("[grd-04] Claim verdict intent detectado (stream) — retornando orientacao sem LLM.");
      const answer = claimGuidanceMessage();
      let conversationId: string | undefined;
      if (options?.brokerId) {
        conversationId = await saveConversation({ brokerId: options.brokerId, channel: options.channel ?? "api", message: question, response: answer, model: "claim-verdict-guard", tokensUsed: 0, latencyMs: Date.now() - startTime, sources: [] });
      }
      yield { type: "token", delta: answer };
      yield { type: "meta", model: "claim-verdict-guard", conversationId, citations: [], tokensUsed: 0, latencyMs: Date.now() - startTime, confidenceScore: 1.0, avgSimilarity: 0, sourceCount: 0, lowConfidence: false, citationCoverage: 1, invalidCitationIndexes: [], answerWarnings: [] };
      return;
    }

    let rateIntentDetected = false;

    if (mentionedInsurers.length === 1) {
      const intent = detectRateIntent(question, mentionedInsurers[0]);
      if (intent.hasIntent) {
        rateIntentDetected = intent.hasIntent;
        const insurerIds = await resolveInsurerIds(mentionedInsurers);
        const ids = insurerIds.values().next().value;
        if (ids && ids.length > 0) {
          const rateRows = await queryRateTable({
            insurerId: ids[0],
            productHint: intent.productHint,
            productHints: intent.productHints,
            productCode: intent.productCode,
            productCodes: intent.productCodes,
            age: intent.age,
            gender: intent.gender,
            rendaMensal: intent.rendaMensal,
            capital: intent.capital,
            franquia: intent.franquia,
            limit: 40,
          });

          if (rateRows.length > 0) {
            const hasAgeAndCapital =
              intent.age !== undefined && intent.capital !== undefined;
            const hasProductCodeFull =
              intent.productCode !== undefined &&
              intent.age !== undefined &&
              intent.gender !== undefined &&
              intent.capital !== undefined;
            const hasProductCodeRate =
              intent.productCode !== undefined &&
              intent.age !== undefined &&
              intent.gender !== undefined;
            const hasProductCodeComparison =
              (intent.productCodes?.length ?? 0) >= 2;
            const hasEnoughDimensions = hasAgeAndCapital || hasProductCodeFull || hasProductCodeRate || hasProductCodeComparison;
            const confidence = hasEnoughDimensions ? 1.0 : 0.4;
            let answer = formatRateAnswer({
              insurerName: mentionedInsurers[0],
              intent,
              rows: rateRows,
            });
            if (compareIntent) {
              answer += `\n\n**Comparativo com outras seguradoras:** encontrei taxa estruturada apenas para ${mentionedInsurers[0]} nesta consulta. Para comparar premio exato com as demais seguradoras, e necessario ter a tabela/cotacao correspondente importada ou informada.`;
            }

            if (!hasEnoughDimensions) {
              answer = `> [Aviso] Consulta com parametros incompletos. Informe idade, sexo e capital segurado para garantir taxa correta.\n\n${answer}`;
            }

            let conversationId: string | undefined;
            if (options?.brokerId) {
              conversationId = await saveConversation({
                brokerId: options.brokerId,
                channel: options.channel ?? "api",
                message: question,
                response: answer,
                model: "rate-table-lookup",
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                sources: [],
              });
            }

            yield { type: "token", delta: answer };
            yield {
              type: "meta",
              model: "rate-table-lookup",
              conversationId,
              citations: [],
              tokensUsed: 0,
              latencyMs: Date.now() - startTime,
              confidenceScore: confidence,
              avgSimilarity: confidence,
              sourceCount: rateRows.length,
              lowConfidence: !hasEnoughDimensions,
              citationCoverage: 1,
              invalidCitationIndexes: [],
              answerWarnings: hasEnoughDimensions
                ? []
                : [
                    "Consulta de taxa com parametros incompletos; confirme idade, sexo e capital segurado.",
                  ],
            };
            return;
          }
        }
      }
    }

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
          const r = await hybridSearch(expandedQuery, {
            ...corpusCtx,
            insurerId: id,
            topK: perInsurer,
          });
          nameResults.push(...r);
        }
        searchResults.push(...nameResults);
      }

      if (searchResults.length === 0) {
        searchResults = await hybridSearch(expandedQuery, {
          ...corpusCtx,
          insurerId: options?.insurerFilter,
          topK: RAG.fetchK,
        });
      }
    } else {
      searchResults = await hybridSearch(expandedQuery, {
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

    // GRD-02: recusar fonte ausente — quando pergunta menciona seguradora X mas nenhum chunk corresponde
    if (mentionedInsurers.length > 0) {
      const requestedIds = new Set([...(await resolveInsurerIds(mentionedInsurers)).values()].flat());
      const retrievedIds = new Set(searchResults.map((r) => r.insurer_id).filter((id): id is string => Boolean(id)));
      const hasMatch = [...retrievedIds].some((id) => requestedIds.has(id));
      // WR-01: requestedIds.size === 0 => seguradora detectada na pergunta mas
      // SEM linha na tabela insurers (caso H05/G-04). Recusar tambem — senao o
      // fallback global preenche o contexto com chunks de OUTRAS seguradoras.
      if (!hasMatch) {
        console.log(`[grd-02] Insurer source mismatch (stream) — requested=${mentionedInsurers.join(",")} (resolvedIds=${requestedIds.size}) nao casa com nenhum chunk recuperado. Recusando.`);
        const answer = `Nao tenho documentos da ${mentionedInsurers.join(" / ")} indexados para responder isso com seguranca. Nao posso usar documentos de outra seguradora como substituto.`;
        let conversationId: string | undefined;
        if (options?.brokerId) {
          conversationId = await saveConversation({ brokerId: options.brokerId, channel: options.channel ?? "api", message: question, response: answer, model: "insurer-source-guard", tokensUsed: 0, latencyMs: Date.now() - startTime, sources: [] });
        }
        yield { type: "token", delta: answer };
        yield { type: "meta", model: "insurer-source-guard", conversationId, citations: [], tokensUsed: 0, latencyMs: Date.now() - startTime, confidenceScore: 1.0, avgSimilarity: 0, sourceCount: 0, lowConfidence: false, citationCoverage: 1, invalidCitationIndexes: [], answerWarnings: [] };
        return;
      }
    }

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
    // ---- 5. Prompt + stream ----
    // Stream path (dashboard SSE). Channel whatsapp suprime FONTES porque o
    // canal injeta citacoes via formatRagResponse — guard defensivo.
    // WR-02/GRD-01: o fast-path deterministico continua restrito a 1 seguradora,
    // mas a proibicao de aritmetica no prompt cobre TODOS os paths com intent de
    // taxa — 0 seguradoras (G-01/G-03) e 2+ seguradoras (comparativos) incluidos.
    // detectRateIntent sem insurer e regex puro (barato) e ja exige qualifier
    // (idade/capital/produto), o que evita disparo em perguntas conceituais.
    const llmArithmeticBlocked = rateIntentDetected || detectRateIntent(question).hasIntent;
    let baseTemplate =
      options?.channel === "whatsapp"
        ? stripSourcesSection(SYSTEM_PROMPT_TEMPLATE)
        : SYSTEM_PROMPT_TEMPLATE;
    if (llmArithmeticBlocked) {
      console.log('[grd-01] Rate intent sem fast-path — injetando proibicao de aritmetica de premio no systemPrompt.')
      baseTemplate =
        baseTemplate +
        '\n\n## PROIBIDO (GRD-01)\nNAO realize nenhuma aritmetica de premio, taxa ou capital. ' +
        'NAO multiplique, divida, nem converta valores monetarios (R$, centavos, mensal/anual). ' +
        'Se o usuario pediu um calculo de premio/taxa, responda que o calculo exato depende da tabela ' +
        'estruturada da seguradora e que ela nao foi encontrada para os parametros informados. ' +
        'Apresente apenas informacoes textuais das condicoes gerais, nunca um numero calculado por voce.'
    }
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

    // ---- 6. Citation audit + save ----
    const citationAudit = auditCitations(fullText, sources);
    const answerWarnings = buildRagAnswerWarnings({
      sourceCount,
      confidenceScore,
      citationsCount: citationAudit.citations.length,
      invalidCitationIndexes: citationAudit.invalidCitationIndexes,
    });
    const finalConfidenceScore = adjustConfidenceForCitationAudit(confidenceScore, {
      sourceCount,
      citationsCount: citationAudit.citations.length,
      invalidCitationIndexes: citationAudit.invalidCitationIndexes,
    });
    const finalLowConfidence = finalConfidenceScore < LOW_CONFIDENCE_THRESHOLD;

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
        sources: citationAudit.citations,
      });
    }

    yield {
      type: "meta",
      model,
      conversationId,
      citations: citationAudit.citations,
      tokensUsed,
      latencyMs: Date.now() - startTime,
      confidenceScore: finalConfidenceScore,
      avgSimilarity,
      sourceCount,
      lowConfidence: finalLowConfidence,
      citationCoverage: citationAudit.citationCoverage,
      invalidCitationIndexes: citationAudit.invalidCitationIndexes,
      answerWarnings,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro inesperado ao processar.";
    console.error("[rag/stream] error:", err);
    yield { type: "error", message };
  }
}
