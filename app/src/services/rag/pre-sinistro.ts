/**
 * Pré-Sinistro Analyzer
 *
 * Killer feature: analisa evento contra condicoes gerais da seguradora ANTES
 * de abrir sinistro. Retorna veredicto estruturado + checklist + risk flags.
 *
 * Flow: search RAG filtered by insurer -> build context -> LLM JSON-mode
 * -> structured output.
 */

import OpenAI from "openai";
import { semanticSearch } from "./search";
import { buildContext } from "./context-builder";
import { resolveInsurerIds, loadEnrichment } from "./answer";
import { RAG } from "@/config/constants";

export type Verdict = "COBERTO" | "NAO_COBERTO" | "RISCO";

export interface PreSinistroResult {
  verdict: Verdict;
  confidence: number; // 0-1
  rationale: string;
  citation: {
    insurer: string;
    clause: string | null;
    source_url: string | null;
    excerpt: string;
  } | null;
  documentsChecklist: string[];
  laudoTerms: string[];
  riskFlags: string[];
  model: string;
  latencyMs: number;
  // Chunks RAG usados como contexto do LLM. Expostos pro harness Ragas
  // avaliar faithfulness contra os chunks reais (nao so o excerpt da citacao).
  chunks: Array<{
    content: string;
    similarity: number;
    source_url: string | null;
    insurer_id: string | null;
  }>;
}

export interface PreSinistroInput {
  insurerName: string;
  claimType: string; // "morte_natural" | "morte_acidental" | "invalidez" | "doenca_grave" | "diaria" | ...
  description: string; // descricao livre do evento
}

const SYSTEM_PROMPT = `Voce e SOLOMON, especialista em analise pre-sinistro de seguros de vida no Brasil.

MISSAO: O corretor te descreve um evento (morte, invalidez, doenca grave, etc) que aconteceu com o segurado. Voce analisa contra as condicoes gerais da seguradora fornecidas abaixo e retorna um VEREDICTO ESTRUTURADO.

TAREFA: Cruzar o evento com:
1. Coberturas vigentes
2. Exclusoes (o que NAO cobre)
3. Carencias (prazos minimos apos contratacao)
4. Contestabilidade (prazos de declaracoes)
5. Definicoes tecnicas da clausula (ex: "infarto agudo" vs "angina")

VOCE DEVE RETORNAR APENAS UM JSON VALIDO com este schema exato (sem markdown, sem \`\`\`json):
{
  "verdict": "COBERTO" | "NAO_COBERTO" | "RISCO",
  "confidence": 0.0-1.0,
  "rationale": "Explicacao em 2-4 frases em linguagem de corretor",
  "citation": {
    "insurer": "Nome da seguradora",
    "clause": "Numero ou nome da clausula (ex: 4.2, Clausula de Exclusoes)",
    "source_url": "URL do PDF se disponivel",
    "excerpt": "Trecho literal de ate 300 caracteres da condicao geral que fundamenta"
  },
  "documentsChecklist": [
    "Lista de documentos necessarios para abrir o sinistro",
    "Ex: Certidao de obito",
    "Ex: Laudo medico com CID-10",
    "Ex: Boletim de ocorrencia (em caso de acidente)"
  ],
  "laudoTerms": [
    "Termos tecnicos exatos que o laudo/documento medico deve conter",
    "Ex: diagnostico de 'infarto agudo do miocardio' (nao 'angina' ou 'isquemia')",
    "Ex: grau de invalidez permanente em %"
  ],
  "riskFlags": [
    "Avisos de risco para o corretor",
    "Ex: Carencia de 2 anos para doencas pre-existentes",
    "Ex: Contestabilidade de 24 meses — se apolice < 24 meses, seguradora pode contestar DPS",
    "Ex: Exclusao por auto-extermineo nos primeiros 2 anos"
  ]
}

REGRAS:
- verdict "COBERTO": evento e claramente coberto, sem risco
- verdict "RISCO": pode ser coberto mas ha fatores que podem levar a negativa (carencia, DPS, contestabilidade, exclusao proxima)
- verdict "NAO_COBERTO": evento esta em exclusao clara ou fora do escopo da cobertura
- Se nao houver informacao suficiente, use verdict "RISCO" com confidence baixa
- SEMPRE preencher documentsChecklist, laudoTerms, riskFlags com ao menos 1 item cada
- Retornar APENAS o JSON, sem texto adicional, sem \`\`\`json wrapper

DOCUMENTOS DE REFERENCIA DA SEGURADORA:
{context}`;

/**
 * Analyzes a pre-claim scenario against the insurer's conditions.
 */
export async function analyzePreSinistro(
  input: PreSinistroInput
): Promise<PreSinistroResult> {
  const start = Date.now();

  // 1. Resolve insurer id(s)
  const insurerMap = await resolveInsurerIds([input.insurerName]);
  const insurerIds = insurerMap.values().next().value;

  if (!insurerIds || insurerIds.length === 0) {
    throw new Error(`Seguradora "${input.insurerName}" nao encontrada na base.`);
  }

  // 2. Search RAG with insurer filter — broader topK for pre-sinistro
  const query = buildSearchQuery(input);
  let results = [];
  for (const id of insurerIds) {
    const r = await semanticSearch(query, { insurerId: id, topK: 8 });
    results.push(...r);
  }
  results = results.slice(0, 12);

  if (results.length === 0) {
    throw new Error(
      `Nao encontrei condicoes gerais da ${input.insurerName} para analisar este evento.`
    );
  }

  // 3. Build context
  const enrichment = await loadEnrichment(results);
  const { contextText } = buildContext(results, enrichment);

  // 4. Build user message
  const userMessage = `Analise este evento:

Seguradora: ${input.insurerName}
Tipo de evento: ${humanizeClaimType(input.claimType)}
Descricao do evento: ${input.description}

Retorne o JSON estruturado conforme schema.`;

  const systemPrompt = SYSTEM_PROMPT.replace("{context}", contextText);

  // 5. Call LLM with JSON mode
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    throw new Error("OPENROUTER_API_KEY nao configurada");
  }

  const client = new OpenAI({
    apiKey: openrouterKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://solomon.aurios.com.br",
      "X-Title": "SOLOMON - Pre-Sinistro",
    },
  });

  // Pre-sinistro e decisao juridica de alta consequencia (veredicto COBERTO /
  // NAO_COBERTO / RISCO vira laudo para o corretor). Usa Sonnet 4.6 aqui, mesmo
  // custando ~3x mais que Haiku 4.5: o custo extra (~R$0,02/analise) e
  // negligivel perto do custo de um veredicto errado em sinistro.
  const completion = await client.chat.completions.create({
    model: "anthropic/claude-sonnet-4.6",
    temperature: 0.2,
    max_tokens: 2048,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = extractJson<Partial<PreSinistroResult>>(raw);
  if (!parsed) {
    console.error("[pre-sinistro] JSON parse failed. Raw:", raw.slice(0, 800));
    throw new Error(
      "LLM retornou resposta invalida. Tente novamente ou reformule o evento."
    );
  }

  return {
    verdict: normalizeVerdict(parsed.verdict),
    confidence: clampConfidence(parsed.confidence),
    rationale:
      parsed.rationale ??
      "Analise inconclusiva — reformule a descricao com mais detalhes.",
    citation: parsed.citation ?? null,
    documentsChecklist: Array.isArray(parsed.documentsChecklist)
      ? parsed.documentsChecklist
      : [],
    laudoTerms: Array.isArray(parsed.laudoTerms) ? parsed.laudoTerms : [],
    riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
    model: completion.model,
    latencyMs: Date.now() - start,
    chunks: results.map((r) => ({
      content: r.content,
      similarity: r.similarity,
      source_url: r.source_url,
      insurer_id: r.insurer_id,
    })),
  };
}

function buildSearchQuery(input: PreSinistroInput): string {
  const claimTerms: Record<string, string> = {
    morte_natural: "cobertura morte natural carencia exclusao causas",
    morte_acidental: "morte por acidente AP acidente pessoal exclusoes",
    invalidez:
      "invalidez permanente IPA invalidez por doenca IPD acidente percentual capital",
    doenca_grave: "doencas graves DG CID cobertura carencia exclusoes",
    diaria: "DIT diaria incapacidade temporaria cobertura carencia",
    internacao: "internacao hospitalar diaria hospitalar",
  };

  const baseTerms = claimTerms[input.claimType] ?? input.claimType;
  return `${baseTerms} ${input.description}`;
}

function humanizeClaimType(t: string): string {
  const map: Record<string, string> = {
    morte_natural: "Morte natural (por doenca)",
    morte_acidental: "Morte por acidente",
    invalidez: "Invalidez permanente",
    doenca_grave: "Doenca grave",
    diaria: "Diaria por incapacidade temporaria",
    internacao: "Internacao hospitalar",
  };
  return map[t] ?? t;
}

function normalizeVerdict(v: unknown): Verdict {
  if (v === "COBERTO" || v === "NAO_COBERTO" || v === "RISCO") return v;
  return "RISCO";
}

function clampConfidence(c: unknown): number {
  if (typeof c !== "number" || !Number.isFinite(c)) return 0.5;
  return Math.max(0, Math.min(1, c));
}

/**
 * Tolerant JSON extractor: tries direct parse, then strips ```json fences,
 * then extracts the largest {...} block.
 */
function extractJson<T>(raw: string): T | null {
  if (!raw) return null;

  // Direct
  try {
    return JSON.parse(raw) as T;
  } catch {}

  // Strip ```json ... ``` fence
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {}
  }

  // Extract balanced {...} (first opening brace → last closing brace)
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const candidate = raw.slice(first, last + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {}
  }

  return null;
}
