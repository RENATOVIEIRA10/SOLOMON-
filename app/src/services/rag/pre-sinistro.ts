/**
 * PrÃ©-Sinistro Analyzer
 *
 * Killer feature: analisa evento contra condicoes gerais da seguradora ANTES
 * de abrir sinistro. Retorna veredicto estruturado + checklist + risk flags.
 *
 * Sessao 2 (2026-04-28) hardenings (Codex review):
 * - resolveInsurerIdsExact (match exato â€” sem substring traz seguradoras erradas)
 * - busca paralela por insurerIds + sort por similarity DESC antes do slice
 * - minimo evidencia (>=3 chunks E avg sim >= 0.50) ou downgrade RISCO
 * - productHint opcional pra filtrar chunks por metadata.product_name
 * - post-validation veredicto: COBERTO requer chunk com cobertura;
 *   NAO_COBERTO requer chunk com exclusao explicita; senao downgrade RISCO
 * - validacao citation/excerpt: trecho deve aparecer literal em chunks
 *
 * Wave A.2 (2026-05-12): Anthropic Citations API removida â€” saldo Anthropic
 * SDK direto morreu em prod. Substituido por Gemini 2.5 Flash com
 * responseMimeType=application/json. Citacoes literais agora dependem do
 * prompt + validateCitation() (substring >=30 chars contra chunks reais).
 */

import { randomUUID } from "node:crypto";

import {
  embedQuery,
  hybridSearchWithEmbedding,
  rerankWithCohere,
  type SearchResult,
} from "./search";
import { loadEnrichment } from "./answer";
import { createServiceClient } from "@/lib/supabase";
import { callStructuredJson } from "./llm-router";

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
  humanReviewRequired: boolean;
  legalDisclaimer: string;
  evidenceSummary: {
    chunkCount: number;
    avgSimilarity: number;
    hasValidatedCitation: boolean;
  };
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
  // F1: evidencia por claim — uma unica citation nao sustenta um rationale
  // com varias afirmacoes distintas. Claims de apolice citam os chunkIds
  // que os sustentam; claims juridicos (Art. 766 CC, SUSEP, etc) ficam
  // sempre validated=false ate o corpus juridico da F2.
  claimEvidence: ClaimEvidence[];
}

/**
 * F1: evidencia por claim atomico. `type: "apolice"` cobre afirmacoes
 * tiradas das condicoes gerais indexadas (validaveis contra os chunks do
 * contexto); `type: "juridico"` cobre afirmacoes de lei/CC/SUSEP, que nao
 * tem corpus indexado ainda (F2) e por isso ficam sempre nao-validadas.
 */
export interface ClaimEvidence {
  claim: string;
  type: "apolice" | "juridico";
  chunkIds: number[];
  validated: boolean;
}

/**
 * Valida claims atomicos retornados pelo LLM contra o contexto de chunks
 * enviado (results.length). Pura, sem I/O — testada isoladamente em
 * scripts/phase2/pre-sinistro-claim-evidence.test.ts.
 *
 * - claim de apolice: valido so se citou >=1 chunkId E todos existem no
 *   contexto (1..chunkCount, mesmo indice 1-based usado nos [chunk_N]
 *   do prompt).
 * - claim juridico: sempre nao-validado ate o corpus juridico da F2.
 *
 * `raw` vem de JSON.parse() do completion do LLM — nao ha garantia de
 * shape (item pode faltar `chunkIds`, `chunkIds` pode ser string/nao-array,
 * ids podem ser nao-inteiros). Cada item e coagido individualmente pra que
 * um objeto malformado nunca derrube o veredicto/citation/checklist inteiro
 * (trilho de alta consequencia juridica — ver findings da review Task 7).
 */
export function validateClaimEvidence(
  raw: unknown[],
  chunkCount: number
): ClaimEvidence[] {
  return raw.map((item) => {
    const c = (item && typeof item === "object" ? item : {}) as {
      claim?: unknown;
      type?: unknown;
      chunkIds?: unknown;
    };
    const ids = (Array.isArray(c.chunkIds) ? c.chunkIds : []).filter(
      (i): i is number => Number.isInteger(i)
    );
    const type: ClaimEvidence["type"] = c.type === "juridico" ? "juridico" : "apolice";
    const claim = typeof c.claim === "string" ? c.claim : "";
    return {
      claim,
      type,
      chunkIds: ids,
      // Fail-closed (Codex review, trilho juridico): validated so pode ser
      // true quando o `type` bruto do LLM e EXPLICITAMENTE "apolice". O
      // campo `type` de saida acima continua coagindo unknown/garbled pra
      // "apolice" (mantido fiel pra exibicao), mas usar esse valor coagido
      // aqui reabriria o buraco - um claim malformado (type ausente/garbled)
      // com chunkIds validos em range virava validated:true por acidente
      // (overclaiming em trilho de alta consequencia juridica).
      validated:
        c.type === "apolice" && ids.length > 0 && ids.every((i) => i >= 1 && i <= chunkCount),
    };
  });
}

/**
 * Shape bruto retornado pelo LLM (JSON.parse do completion.text). `claims`
 * nao existe em `PreSinistroResult` (que expoe `claimEvidence` ja validado)
 * â€” e o campo cru do schema do SYSTEM_PROMPT, consumido so por
 * validateClaimEvidence() logo apos o parse.
 */
type PreSinistroLlmOutput = Partial<PreSinistroResult> & {
  claims?: Array<{ claim: string; type: "apolice" | "juridico"; chunkIds: number[] }>;
};

export interface PreSinistroInput {
  insurerName: string;
  claimType: string; // "morte_natural" | "morte_acidental" | "invalidez" | "doenca_grave" | "diaria" | ...
  description: string; // descricao livre do evento
  /** Nome ou codigo do produto/apolice (opcional). Filtra chunks por metadata.product_name. */
  productHint?: string;
  /**
   * F1: contexto RAG pre-computado (Task 4 A/B harness). Quando setado, pula
   * o retrieval inteiro e usa estes resultados como estao â€” garante que os
   * dois modelos comparados no A/B pareado veem exatamente o mesmo contexto.
   */
  precomputedResults?: SearchResult[];
  /**
   * Task 4 (A/B harness): troca o modelo gerador DESTA chamada sem depender
   * de env var (PRE_SINISTRO_MODEL e lido no load do modulo, entao override
   * por process.env nao funciona in-process). Producao nunca seta isto.
   */
  modelOverride?: string;
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
    "excerpt": "Trecho LITERAL de ate 300 caracteres da condicao geral que fundamenta â€” DEVE aparecer textualmente nos documents"
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
  ],
  "claims": [
    {
      "claim": "Afirmacao atomica (uma unica ideia verificavel) usada no rationale",
      "type": "apolice" | "juridico",
      "chunkIds": [1, 3]
    }
  ]
}

REGRAS CRITICAS:
- verdict "COBERTO": evento e claramente coberto, sem risco. Exige chunk de cobertura explicita.
- verdict "RISCO": pode ser coberto mas ha fatores que podem levar a negativa (carencia, DPS, contestabilidade, exclusao proxima).
- verdict "NAO_COBERTO": evento esta em exclusao clara ou fora do escopo da cobertura. Exige chunk com exclusao explicita.
- Se nao houver evidencia textual clara, use verdict "RISCO" com confidence baixa.
- excerpt da citation DEVE ser trecho LITERAL dos chunks [chunk_N] fornecidos â€” sem parafrase. O sistema valida substring contra os chunks reais e descarta a citacao se nao bater.
- SEMPRE preencher documentsChecklist, laudoTerms, riskFlags com ao menos 1 item cada.
- claims: quebre o rationale em afirmacoes atomicas (uma ideia verificavel por item). Toda afirmacao de apolice (cobertura, exclusao, carencia, contestabilidade, definicao de clausula) DEVE citar em chunkIds os numeros dos [chunk_N] que a sustentam (type="apolice", chunkIds nunca vazio). Afirmacao juridica de lei/norma (ex: Art. 766 CC, SUSEP, Codigo de Defesa do Consumidor) que NAO vem de um chunk indexado usa type="juridico" com chunkIds=[] â€” nao invente numero de chunk pra afirmacao juridica.
- Retornar APENAS o JSON, sem texto adicional, sem fence.
`;

/**
 * Retrieval do pre-sinistro (F1: hybrid + dois-k + rerank Cohere, reusando
 * os mesmos blocos do oraculo em answer.ts). Exportado pro harness de
 * correctness A/B (Task 4): recuperar o contexto UMA vez aqui e injeta-lo
 * nos dois modelos comparados via `precomputedResults` garante que os dois
 * bracos veem exatamente os mesmos chunks.
 */
export async function retrievePreSinistroContext(
  input: Omit<PreSinistroInput, "precomputedResults" | "modelOverride">
): Promise<SearchResult[]> {
  const normalizedClaimType = normalizeClaimType(input.claimType);

  // Resolve insurer id(s) via match EXATO -- substring match podia trazer
  // 2 seguradoras (HIGH 6 do Codex review).
  const insurerIds = await resolveInsurerIdsExact(input.insurerName);

  const query = buildSearchQuery({ ...input, claimType: normalizedClaimType });
  // Slice 3C-c: corpus-routing context. pre-sinistro is single-insurer
  // per analysis -> eligible for shadow preview when input.insurerName
  // is in SHADOW_PREVIEW_INSURERS.
  const corpusCtx = {
    insurerNames: [input.insurerName] as readonly string[],
    requestId: randomUUID(),
    question: query,
    source: "pre-sinistro" as const,
  };

  // Phase 3A G2: pre-sinistro queries are always verbal -> restrict to
  // conditions_pdf. rate_table_pdf chunks would inject numeric noise that
  // poisons the verdict and the citation validation downstream.
  //
  // F1 (multi-query fan-out): uma unica query embutida ("cliente 52 anos
  // com cancer") nao casa bem com o texto literal da clausula ("periodo
  // de sobrevivencia de 30 dias") -- mismatch semantico entre a descricao
  // livre do corretor e a linguagem juridica das condicoes gerais. Em vez
  // de embedar so `query`, decompomos o caso em sub-queries por dimensao
  // (buildSubQueries) e buscamos para cada uma, por insurerId, unindo e
  // dedupando os candidatos antes de um UNICO rerank na query primaria.
  // topK por chamada e dividido pelo numero de sub-queries pra manter o
  // total de candidatos no mesmo teto (~24-40) em vez de sub-queries x 32.
  const subQueries = buildSubQueries({
    ...input,
    claimType: normalizedClaimType,
  });
  const perQueryTopK = Math.ceil(PRE_SINISTRO_FETCH_K / subQueries.length);

  const settled = await Promise.all(
    subQueries.map(async (sq) => {
      const sqEmbedding = await embedQuery(sq);
      return Promise.all(
        insurerIds.map((id) =>
          hybridSearchWithEmbedding(sq, sqEmbedding, {
            ...corpusCtx,
            insurerId: id,
            topK: perQueryTopK,
            sourceType: "conditions_pdf",
            // As sub-queries de "exclusoes" e "carencia" (buildSubQueries)
            // colidem com detectExhaustiveIntent (search.ts) e disparariam
            // o atalho TOC-por-secao (fetchChunksByToc), que corta as
            // primeiras `topK` clausulas em ORDEM DOCUMENTAL, nao por
            // relevancia semantica -- com similarity=1.0 hardcoded que
            // mascara o guardrail avgSim<0.5 downstream. O pre-sinistro
            // quer relevancia semantica consistente nas 5 dimensoes do
            // fan-out; uma clausula enterrada (ex: "periodo de
            // sobrevivencia de 30 dias") past position 7 seria descartada
            // silenciosamente. TOC-vs-vector pra exclusao/carencia fica
            // em aberto pro A/B do Task 4 na VPS.
            disableExhaustiveIntent: true,
          })
        )
      );
    })
  );

  // Deduplicate por id (fan-out entre sub-queries x insurerIds pode
  // repetir o mesmo chunk varias vezes).
  const seen = new Set<string>();
  const candidates = settled.flat(2).filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  // Rerank cross-encoder (Cohere) usa a query PRIMARIA (nao as sub-queries)
  // pra trazer a clausula certa pro topo do contexto final; fallback =
  // ordem por similarity se COHERE_API_KEY ausente ou a chamada falhar
  // (ver rerankWithCohere em search.ts).
  return rerankWithCohere(query, candidates, PRE_SINISTRO_RERANK_K);
}

/**
 * Analyzes a pre-claim scenario against the insurer's conditions.
 */
/**
 * Modelo configuravel via env var. F0: trocado de `gemini-2.5-flash` (Wave A.2)
 * pra `anthropic/claude-sonnet-4.6` via llm-router (OpenRouter-first, fallback
 * anthropic-direct) - trilho de alta consequencia juridica exige o raciocinio
 * mais forte disponivel, nao o mais barato.
 */
const PRE_SINISTRO_MODEL =
  process.env.PRE_SINISTRO_MODEL ?? "anthropic/claude-sonnet-4.6";
const LEGAL_DISCLAIMER =
  "Analise preliminar para apoio do corretor. Nao substitui regulacao formal do sinistro pela seguradora nem parecer juridico.";

/**
 * F1 (retrieval hardening): dois-k â€” recall largo, contexto final enxuto.
 * O oraculo (answer.ts) ja usa hybrid + rerank; pre-sinistro so tinha
 * semanticSearch topK=8 -> slice(0,12), sem hybrid nem cross-encoder, o que
 * deixava clausulas relevantes (ex: "sobrevivencia"/"carencia" na Prudential)
 * fora do top-8 mesmo existindo centenas de chunks no corpus.
 */
const PRE_SINISTRO_FETCH_K = 32; // recall: candidatos recuperados (24-40)
const PRE_SINISTRO_RERANK_K = 10; // contexto: chunks enviados ao modelo (8-12)

export async function analyzePreSinistro(
  input: PreSinistroInput
): Promise<PreSinistroResult> {
  const start = Date.now();
  const normalizedClaimType = normalizeClaimType(input.claimType);
  const model = input.modelOverride ?? PRE_SINISTRO_MODEL;

  // 1+2. Retrieval (resolucao de seguradora + fan-out + rerank) vive em
  // retrievePreSinistroContext(). precomputedResults (Task 4 A/B harness)
  // pula o retrieval INTEIRO -- inclusive a resolucao de seguradora -- pra
  // garantir contexto identico entre os dois modelos comparados.
  let results: SearchResult[];
  if (input.precomputedResults) {
    results = input.precomputedResults;
  } else {
    results = await retrievePreSinistroContext(input);
  }

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
        model,
        rationale: `Produto/apolice "${input.productHint}" nao encontrado em chunks indexados da ${input.insurerName}. Verifique o nome do produto ou solicite condicoes gerais especificas.`,
        riskFlags: [`productHint=${input.productHint} nao indexado`],
        chunks: results,
      });
    }
    results = filtered;
  }

  // 4. Minimo de evidencia (HIGH 4): se results.length < 3 OU avg sim < 0.50,
  // NAO chama LLM â€” retorna RISCO pre-fabricado. Evita laudo juridico em
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
      model,
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
${input.productHint ? `Produto/apolice: ${input.productHint}\n` : ""}Tipo de evento: ${humanizeClaimType(normalizedClaimType)}
Descricao do evento: ${input.description}

Cite trecho LITERAL de um dos chunks no campo citation.excerpt â€” o sistema valida substring contra os chunks reais. Retorne APENAS o JSON estruturado.`;

  // 7. Call LLM via llm-router (OpenRouter-first, fail-closed) - F0: Sonnet 4.6.
  const completion = await callStructuredJson(SYSTEM_PROMPT, userMessage, {
    model,
    temperature: 0.2,
    maxOutputTokens: 4096,
    timeoutMs: 40000, // Sonnet e mais lento que Flash
  });

  const parsed = extractJson<PreSinistroLlmOutput>(completion.text);
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
  const rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale
      : "Analise inconclusiva â€” reformule a descricao com mais detalhes.";
  let riskFlags = Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [];
  let finalConfidence = clampConfidence(parsed.confidence);

  // Validar citation/excerpt contra chunks reais (CRITICAL 1).
  // Wave A.2: sem Citations API nativa, este e o unico guard contra paraphrase
  // do Gemini â€” se o LLM nao copiou trecho fiel, citation vira null.
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
  // Ragas faithfulness e medida contra o rationale; texto nao-grounded aqui
  // faz F cair. riskFlags sao excluidos pelo harness de eval.
  if (verdict !== "RISCO" && validatedCitation === null) {
    verdict = "RISCO";
    finalConfidence = Math.min(finalConfidence, 0.45);
    riskFlags = addRiskFlag(
      riskFlags,
      "Veredicto conclusivo rebaixado: sem citacao literal validada nos chunks"
    );
  }
  if (verdict === "COBERTO" && !hasEvidenceFor("COBERTO", results)) {
    verdict = "RISCO";
    finalConfidence = Math.min(finalConfidence, 0.45);
    riskFlags = addRiskFlag(
      riskFlags,
      "Downgrade automatico: veredicto COBERTO sem chunk de cobertura explicita nos documentos indexados"
    );
  }
  if (verdict === "NAO_COBERTO" && !hasEvidenceFor("NAO_COBERTO", results)) {
    verdict = "RISCO";
    finalConfidence = Math.min(finalConfidence, 0.45);
    riskFlags = addRiskFlag(
      riskFlags,
      "Downgrade automatico: veredicto NAO_COBERTO sem chunk de exclusao explicita nos documentos indexados"
    );
  }
  const evidenceSummary = {
    chunkCount: results.length,
    avgSimilarity: avgSim,
    hasValidatedCitation: validatedCitation !== null,
  };
  // Trilho fora do piloto (veredito PR #57): toda analise exige revisao humana,
  // independentemente da confianca. Reavaliar quando o trilho entrar no piloto.
  const humanReviewRequired = true;

  return {
    verdict,
    confidence: finalConfidence,
    rationale,
    citation: validatedCitation,
    documentsChecklist: Array.isArray(parsed.documentsChecklist)
      ? parsed.documentsChecklist
      : [],
    laudoTerms: Array.isArray(parsed.laudoTerms) ? parsed.laudoTerms : [],
    riskFlags,
    humanReviewRequired,
    legalDisclaimer: LEGAL_DISCLAIMER,
    evidenceSummary,
    model: completion.model,
    latencyMs: Date.now() - start,
    chunks: toResultChunks(results),
    claimEvidence: validateClaimEvidence(
      Array.isArray(parsed.claims) ? parsed.claims : [],
      results.length
    ),
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
 * â€” pre-sinistro nao pode aceitar nome ambiguo (HIGH 6 Codex review).
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

/**
 * F1 (multi-query fan-out): decompoe o caso em sub-queries por dimensao
 * de cobertura â€” cobertura / exclusao / carencia / faixa etaria / base+produto.
 * Corrige o mismatch semantico entre a descricao livre do evento (ex:
 * "cliente 52 anos com cancer") e o texto literal da clausula (ex: "periodo
 * de sobrevivencia de 30 dias"): uma unica query embutida nao recupera bem
 * todas as dimensoes de uma vez, mas 5 queries dimensionadas sim.
 */
export function buildSubQueries(input: PreSinistroInput): string[] {
  const base = `${input.claimType} ${input.description}`.trim();
  const prod = input.productHint ? ` ${input.productHint}` : "";
  return [
    `cobertura ${base}${prod}`,
    `exclusoes e o que nao cobre para ${input.claimType}${prod}`,
    `carencia e prazos minimos ${input.claimType}${prod}`,
    `limites de idade e faixa etaria de cobertura${prod}`,
    base + prod,
  ];
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

function normalizeClaimType(raw: string): string {
  const t = stripAccentsLower(raw).replace(/[^a-z0-9]+/g, "_");
  if (t.includes("suicidio")) return "morte_natural";
  if (t.includes("morte") && (t.includes("acidental") || t.includes("acidente"))) {
    return "morte_acidental";
  }
  if (t.includes("morte")) return "morte_natural";
  if (t.includes("doenca_grave") || t.includes("doencas_graves") || t.includes("cancer")) {
    return "doenca_grave";
  }
  if (t.includes("invalidez") || t.includes("ipa") || t.includes("ipd") || t.includes("ifpd")) {
    return "invalidez";
  }
  if (t.includes("diaria") || t.includes("dit") || t.includes("incapacidade")) {
    return "diaria";
  }
  if (t.includes("internacao") || t.includes("dih") || t.includes("hospital")) {
    return "internacao";
  }
  return raw;
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
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
 * exclusao (verdict=NAO_COBERTO). Retorna false se nao bater â€” caller
 * downgrade pra RISCO.
 */
export function hasEvidenceFor(
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
  avgSimilarity?: number;
}): PreSinistroResult {
  const avgSimilarity =
    params.avgSimilarity ??
    (params.chunks.length > 0
      ? params.chunks.reduce((acc, r) => acc + (r.similarity ?? 0), 0) / params.chunks.length
      : 0);

  return {
    verdict: "RISCO",
    confidence: 0.3,
    rationale: params.rationale,
    citation: null,
    documentsChecklist: [
      "Condicoes gerais atualizadas da seguradora",
      "Apolice/proposta do segurado",
    ],
    laudoTerms: [
      "Termos clinicos e datas do evento nos documentos medicos",
    ],
    riskFlags: params.riskFlags,
    humanReviewRequired: true,
    legalDisclaimer: LEGAL_DISCLAIMER,
    evidenceSummary: {
      chunkCount: params.chunks.length,
      avgSimilarity,
      hasValidatedCitation: false,
    },
    model: params.model,
    latencyMs: Date.now() - params.start,
    chunks: toResultChunks(params.chunks),
    // Fast-path RISCO (sem chamada ao LLM) nunca teve claims pra validar.
    claimEvidence: [],
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

