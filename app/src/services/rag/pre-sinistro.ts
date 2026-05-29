/**
 * Pré-Sinistro Analyzer
 *
 * Killer feature: analisa evento contra condicoes gerais da seguradora ANTES
 * de abrir sinistro. Retorna veredicto estruturado + checklist + risk flags.
 *
 * Sessao 2 (2026-04-28) hardenings (Codex review):
 * - resolveInsurerIdsExact (match exato — sem substring traz seguradoras erradas)
 * - busca paralela por insurerIds + sort por similarity DESC antes do slice
 * - minimo evidencia (>=3 chunks E avg sim >= 0.50) ou downgrade RISCO
 * - productHint opcional pra filtrar chunks por metadata.product_name
 * - post-validation veredicto: COBERTO requer chunk com cobertura;
 *   NAO_COBERTO requer chunk com exclusao explicita; senao downgrade RISCO
 * - validacao citation/excerpt: trecho deve aparecer literal em chunks
 *
 * Wave A.2 (2026-05-12): Anthropic Citations API removida — saldo Anthropic
 * SDK direto morreu em prod. Substituido por Gemini 2.5 Flash com
 * responseMimeType=application/json. Citacoes literais agora dependem do
 * prompt + validateCitation() (substring >=30 chars contra chunks reais).
 */

import { randomUUID } from "node:crypto";

import { semanticSearch, type SearchResult } from "./search";
import { loadEnrichment } from "./answer";
import { createServiceClient } from "@/lib/supabase";
import { callGeminiJson } from "./llm";

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
  /** Nome ou codigo do produto/apolice (opcional). Filtra chunks por metadata.product_name. */
  productHint?: string;
}

const SYSTEM_PROMPT = `Voce e SOLOMON, especialista em analise pre-sinistro de seguros de vida no Brasil.

MISSAO: O corretor te descreve um evento (morte, invalidez, doenca grave, etc) que aconteceu com o segurado. Voce analisa contra as condicoes gerais da seguradora fornecidas como chunks numerados [chunk_N] na mensagem do usuario e retorna um VEREDICTO ESTRUTURADO.

TAREFA: Cruzar o evento com:
1. Coberturas vigentes
2. Exclusoes (o que NAO cobre)
3. Carencias (prazos minimos apos contratacao)
4. Contestabilidade (prazos de declaracoes)
5. Definicoes tecnicas da clausula (ex: "infarto agudo" vs "angina")

VOCE DEVE RETORNAR APENAS UM JSON VALIDO com este schema exato (sem markdown, sem fence):
{
  "verdict": "COBERTO" | "NAO_COBERTO" | "RISCO",
  "confidence": 0.0-1.0,
  "rationale": "Explicacao em 2-4 frases em linguagem de corretor",
  "citation": {
    "insurer": "Nome da seguradora",
    "clause": "Numero ou nome da clausula (ex: 4.2, Clausula de Exclusoes)",
    "source_url": "URL do PDF se disponivel nos documents",
    "excerpt": "Trecho LITERAL de ate 300 caracteres da condicao geral que fundamenta — DEVE aparecer textualmente nos documents"
  },
  "documentsChecklist": [
    "Lista de documentos necessarios para abrir o sinistro",
    "Ex: Certidao de obito",
    "Ex: Laudo medico com CID-10"
  ],
  "laudoTerms": [
    "Termos tecnicos exatos que o laudo/documento medico deve conter",
    "Ex: diagnostico de 'infarto agudo do miocardio' (nao 'angina')"
  ],
  "riskFlags": [
    "Avisos de risco para o corretor",
    "Ex: Carencia de 2 anos para doencas pre-existentes"
  ]
}

REGRAS CRITICAS:
- verdict "COBERTO": evento e claramente coberto, sem risco. Exige chunk de cobertura explicita.
- verdict "RISCO": pode ser coberto mas ha fatores que podem levar a negativa (carencia, DPS, contestabilidade, exclusao proxima).
- verdict "NAO_COBERTO": evento esta em exclusao clara ou fora do escopo da cobertura. Exige chunk com exclusao explicita.
- Se nao houver evidencia textual clara, use verdict "RISCO" com confidence baixa.
- excerpt da citation DEVE ser trecho LITERAL dos chunks [chunk_N] fornecidos — sem parafrase. O sistema valida substring contra os chunks reais e descarta a citacao se nao bater.
- SEMPRE preencher documentsChecklist, laudoTerms, riskFlags com ao menos 1 item cada.
- Retornar APENAS o JSON, sem texto adicional, sem fence.
`;

/**
 * Analyzes a pre-claim scenario against the insurer's conditions.
 */
/**
 * Modelo configuravel via env var. Default `gemini-2.5-flash` apos Wave A.2.
 * Permite swap pra `gemini-2.5-pro` (raciocinio juridico mais forte) ou volta
 * pra Sonnet via fallback no futuro sem mudar codigo.
 */
const PRE_SINISTRO_MODEL = process.env.PRE_SINISTRO_MODEL ?? "gemini-2.5-flash";

export async function analyzePreSinistro(
  input: PreSinistroInput
): Promise<PreSinistroResult> {
  const start = Date.now();

  // 1. Resolve insurer id(s) via match EXATO — substring match podia trazer
  // 2 seguradoras (HIGH 6 do Codex review).
  const insurerIds = await resolveInsurerIdsExact(input.insurerName);

  // 2. Search RAG paralelamente por insurerIds + sort global por similarity
  // (HIGH 3: era sequencial sem reordenar).
  const query = buildSearchQuery(input);
  const perInsurer = 8;
  // Slice 3C-c: corpus-routing context. pre-sinistro is single-insurer
  // per analysis -> eligible for shadow preview when input.insurerName
  // is in SHADOW_PREVIEW_INSURERS.
  const corpusCtx = {
    insurerNames: [input.insurerName] as readonly string[],
    requestId: randomUUID(),
    question: query,
    source: "pre-sinistro" as const,
  };
  // Phase 3A G2: pre-sinistro queries are always verbal → restrict to
  // conditions_pdf. rate_table_pdf chunks would inject numeric noise that
  // poisons the verdict and the citation validation downstream.
  const settled = await Promise.all(
    insurerIds.map((id) =>
      semanticSearch(query, {
        ...corpusCtx,
        insurerId: id,
        topK: perInsurer,
        sourceType: 'conditions_pdf',
      })
    )
  );
  let results: SearchResult[] = settled.flat();

  // Deduplicate por id + sort por similarity DESC
  const seen = new Set<string>();
  results = results
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    })
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, 12);

  // 3. productHint filter (HIGH 5): se setado e nenhum chunk casa, devolve RISCO.
  if (input.productHint && input.productHint.trim()) {
    const hint = stripAccentsLower(input.productHint);
    const filtered = results.filter((r) => {
      const pname = (r.metadata?.product_name as string | undefined) ?? "";
      return stripAccentsLower(pname).includes(hint);
    });
    if (filtered.length === 0) {
      return buildRiskResult({
        start,
        model: PRE_SINISTRO_MODEL,
        rationale: `Produto/apolice "${input.productHint}" nao encontrado em chunks indexados da ${input.insurerName}. Verifique o nome do produto ou solicite condicoes gerais especificas.`,
        riskFlags: [`productHint=${input.productHint} nao indexado`],
        chunks: results,
      });
    }
    results = filtered;
  }

  // 4. Minimo de evidencia (HIGH 4): se results.length < 3 OU avg sim < 0.50,
  // NAO chama LLM — retorna RISCO pre-fabricado. Evita laudo juridico em
  // documentacao insuficiente.
  if (results.length === 0) {
    throw new Error(
      `Nao encontrei condicoes gerais da ${input.insurerName} para analisar este evento.`
    );
  }
  const avgSim =
    results.reduce((acc, r) => acc + (r.similarity ?? 0), 0) / results.length;
  if (results.length < 3 || avgSim < 0.5) {
    return buildRiskResult({
      start,
      model: PRE_SINISTRO_MODEL,
      rationale: `Documentacao insuficiente da ${input.insurerName} para laudo conclusivo (apenas ${results.length} chunks com similaridade media ${avgSim.toFixed(2)}). Recomendado consultar a seguradora diretamente.`,
      riskFlags: ["Evidencia insuficiente para laudo automatico"],
      chunks: results,
    });
  }

  // 5. Enrich (insurer/product names) pra logging.
  await loadEnrichment(results);

  // 6. Build user message com chunks numerados inline (substitui o documents[]
  // da Anthropic Citations API). Gemini le tudo como contexto unico.
  const chunksBlock = results
    .map((r, idx) => `[chunk_${idx + 1}]\n${r.content}`)
    .join("\n\n");

  const userMessage = `DOCUMENTOS DA SEGURADORA (chunks indexados):

${chunksBlock}

---

ANALISE ESTE EVENTO:

Seguradora: ${input.insurerName}
${input.productHint ? `Produto/apolice: ${input.productHint}\n` : ""}Tipo de evento: ${humanizeClaimType(input.claimType)}
Descricao do evento: ${input.description}

Cite trecho LITERAL de um dos chunks no campo citation.excerpt — o sistema valida substring contra os chunks reais. Retorne APENAS o JSON estruturado.`;

  // 7. Call Gemini JSON — Wave A.2.
  const completion = await callGeminiJson(SYSTEM_PROMPT, userMessage, {
    model: PRE_SINISTRO_MODEL,
    temperature: 0.2,
    maxOutputTokens: 2048,
  });

  const parsed = extractJson<Partial<PreSinistroResult>>(completion.text);
  if (!parsed) {
    console.error(
      "[pre-sinistro] JSON parse failed. Raw:",
      completion.text.slice(0, 800)
    );
    throw new Error(
      "LLM retornou resposta invalida. Tente novamente ou reformule o evento."
    );
  }

  // 8. Post-validation: veredicto + citation contra evidencia textual nos chunks
  let verdict = normalizeVerdict(parsed.verdict);
  let rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale
      : "Analise inconclusiva — reformule a descricao com mais detalhes.";
  let riskFlags = Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [];

  // Validar citation/excerpt contra chunks reais (CRITICAL 1).
  // Wave A.2: sem Citations API nativa, este e o unico guard contra paraphrase
  // do Gemini — se o LLM nao copiou trecho fiel, citation vira null.
  const validatedCitation = validateCitation(parsed.citation, results);
  if (parsed.citation && validatedCitation === null) {
    riskFlags = addRiskFlag(
      riskFlags,
      "Citacao removida automaticamente: trecho nao encontrado nos chunks indexados"
    );
  }

  // Post-validation verdict (CRITICAL 2).
  // NOTA: o sinal de downgrade vai para riskFlags, NAO para rationale.
  // O rationale permanece como output puro do LLM (grounded nos chunks).
  // Ragas faithfulness e medida contra o rationale — texto nao-grounded
  // aqui faz F cair; riskFlags sao excluidos pelo harness de eval.
  if (verdict === "COBERTO" && !hasEvidenceFor("COBERTO", results)) {
    verdict = "RISCO";
    riskFlags = addRiskFlag(
      riskFlags,
      "Downgrade automatico: veredicto COBERTO sem chunk de cobertura explicita nos documentos indexados"
    );
  }
  if (verdict === "NAO_COBERTO" && !hasEvidenceFor("NAO_COBERTO", results)) {
    verdict = "RISCO";
    riskFlags = addRiskFlag(
      riskFlags,
      "Downgrade automatico: veredicto NAO_COBERTO sem chunk de exclusao explicita nos documentos indexados"
    );
  }

  return {
    verdict,
    confidence: clampConfidence(parsed.confidence),
    rationale,
    citation: validatedCitation,
    documentsChecklist: Array.isArray(parsed.documentsChecklist)
      ? parsed.documentsChecklist
      : [],
    laudoTerms: Array.isArray(parsed.laudoTerms) ? parsed.laudoTerms : [],
    riskFlags,
    model: completion.model,
    latencyMs: Date.now() - start,
    chunks: toResultChunks(results),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InsurerRow {
  id: string;
  name: string;
}

/**
 * Resolve insurer ids por match exato (case-insensitive). Sem substring
 * — pre-sinistro nao pode aceitar nome ambiguo (HIGH 6 Codex review).
 */
async function resolveInsurerIdsExact(name: string): Promise<string[]> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Seguradora nao informada");
  }

  const supabase = createServiceClient();

  const exact = await supabase
    .from("insurers")
    .select("id, name")
    .eq("name", trimmed);

  if (exact.error) {
    throw new Error(`Falha ao buscar seguradora: ${exact.error.message}`);
  }

  let matches = (exact.data ?? []) as InsurerRow[];

  if (matches.length === 0) {
    // Fallback case-insensitive (sem wildcards)
    const insensitive = await supabase
      .from("insurers")
      .select("id, name")
      .ilike("name", trimmed);

    if (insensitive.error) {
      throw new Error(`Falha ao buscar seguradora: ${insensitive.error.message}`);
    }

    const lower = trimmed.toLowerCase();
    matches = ((insensitive.data ?? []) as InsurerRow[]).filter(
      (row) => row.name.toLowerCase() === lower
    );
  }

  if (matches.length === 0) {
    throw new Error(`Seguradora "${name}" nao encontrada na base.`);
  }

  if (matches.length > 1) {
    const found = matches.map((m) => m.name).join(", ");
    throw new Error(
      `Nome ambiguo: especifique seguradora exata (encontradas: ${found})`
    );
  }

  return matches.map((m) => m.id);
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
  const productTerms = input.productHint?.trim()
    ? ` ${input.productHint.trim()}`
    : "";
  return `${baseTerms}${productTerms} ${input.description}`;
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

function stripAccentsLower(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(s: string): string {
  return stripAccentsLower(s);
}

const COVERAGE_KEYWORDS = [
  "cobertura",
  "coberto",
  "paga",
  "indeniza",
  "capital segurado",
  "beneficio",
];

const EXCLUSION_KEYWORDS = [
  "exclui",
  "exclusao",
  "exclusoes",
  "nao cobert",
  "nao paga",
  "excluido",
  "excluida",
];

/**
 * Verifica se ha chunk com keyword de cobertura (verdict=COBERTO) ou
 * exclusao (verdict=NAO_COBERTO). Retorna false se nao bater — caller
 * downgrade pra RISCO.
 */
function hasEvidenceFor(
  verdict: "COBERTO" | "NAO_COBERTO",
  results: SearchResult[]
): boolean {
  const keywords = verdict === "COBERTO" ? COVERAGE_KEYWORDS : EXCLUSION_KEYWORDS;
  return results.some((r) => {
    const head = normalizeText(r.content).slice(0, 1500);
    return keywords.some((kw) => head.includes(kw));
  });
}

/**
 * Valida citation: excerpt deve aparecer literal em ao menos 1 chunk
 * (substring de >=30 chars do excerpt normalizado). source_url deve
 * casar com algum source_url dos chunks. Retorna citation limpa ou null.
 */
function validateCitation(
  citation: PreSinistroResult["citation"] | undefined,
  results: SearchResult[]
): PreSinistroResult["citation"] {
  if (!citation || typeof citation !== "object") return null;

  const excerpt =
    typeof citation.excerpt === "string" ? citation.excerpt.trim() : "";
  if (!excerpt) return null;

  if (!excerptFoundInChunks(excerpt, results)) return null;

  let sourceUrl =
    typeof citation.source_url === "string" && citation.source_url.trim()
      ? citation.source_url.trim()
      : null;

  if (sourceUrl && !results.some((r) => r.source_url === sourceUrl)) {
    sourceUrl = null;
  }

  return {
    insurer:
      typeof citation.insurer === "string" && citation.insurer.trim()
        ? citation.insurer.trim()
        : "",
    clause:
      typeof citation.clause === "string" && citation.clause.trim()
        ? citation.clause.trim()
        : null,
    source_url: sourceUrl,
    excerpt,
  };
}

function excerptFoundInChunks(excerpt: string, results: SearchResult[]): boolean {
  const norm = normalizeText(excerpt).replace(/\s+/g, " ").trim();
  if (norm.length < 30) {
    return results.some((r) => normalizeText(r.content).includes(norm));
  }
  if (results.some((r) => normalizeText(r.content).includes(norm))) return true;
  // Try substrings >= 30 chars (excerpt podia ter quebras vs chunks)
  for (const piece of substringsAtLeast30(norm)) {
    if (results.some((r) => normalizeText(r.content).includes(piece))) return true;
  }
  return false;
}

function substringsAtLeast30(text: string): string[] {
  const pieces = new Set<string>();
  if (text.length >= 30) {
    pieces.add(text.slice(0, Math.min(120, text.length)));
    const midStart = Math.max(0, Math.floor(text.length / 2) - 45);
    pieces.add(text.slice(midStart, Math.min(text.length, midStart + 90)));
    pieces.add(text.slice(Math.max(0, text.length - 120)));
  }
  return [...pieces].filter((p) => p.length >= 30);
}

function addRiskFlag(flags: string[], flag: string): string[] {
  if (flags.includes(flag)) return flags;
  return [...flags, flag];
}

function toResultChunks(results: SearchResult[]): PreSinistroResult["chunks"] {
  return results.map((r) => ({
    content: r.content,
    similarity: r.similarity,
    source_url: r.source_url,
    insurer_id: r.insurer_id,
  }));
}

function buildRiskResult(params: {
  start: number;
  model: string;
  rationale: string;
  riskFlags: string[];
  chunks: SearchResult[];
}): PreSinistroResult {
  return {
    verdict: "RISCO",
    confidence: 0.3,
    rationale: params.rationale,
    citation: null,
    documentsChecklist: [
      "Condicoes gerais atualizadas da seguradora",
      "Apolice/proposta do segurado",
    ],
    laudoTerms: [],
    riskFlags: params.riskFlags,
    model: params.model,
    latencyMs: Date.now() - params.start,
    chunks: toResultChunks(params.chunks),
  };
}

/**
 * Tolerant JSON extractor: tries direct parse, then strips ```json fences,
 * then extracts the largest {...} block.
 */
function extractJson<T>(raw: string): T | null {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {}

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {}
  }

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
