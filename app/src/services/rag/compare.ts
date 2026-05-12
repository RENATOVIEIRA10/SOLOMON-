/**
 * Comparador — cruza coberturas, exclusoes e carencias entre seguradoras.
 *
 * Flow: para cada seguradora selecionada, faz busca RAG topica (uma query por
 * dimensao: coberturas, exclusoes, carencias) e constroi um resumo estruturado.
 * Depois, LLM compara e destaca diferencas.
 */

import { semanticSearch } from "./search";
import { buildContext } from "./context-builder";
import { resolveInsurerIds, loadEnrichment } from "./answer";
import { callGeminiJson } from "./llm";

/**
 * Modelo configuravel via env var. Default `gemini-2.5-flash` apos Wave A.2
 * (Anthropic SDK direto fora do ar em prod). Permite swap sem deploy de codigo
 * quando saldo Anthropic voltar ou se quisermos testar Pro.
 */
const COMPARE_MODEL = process.env.COMPARE_MODEL ?? "gemini-2.5-flash";

export interface CompareInput {
  insurerNames: string[]; // 2-3 seguradoras
  productType: string; // "vida_individual" | "vida_em_grupo" | "vida_temporario" | "vida_vitalicio"
}

export interface CompareDimension {
  dimension: string; // "Cobertura morte", "Cobertura invalidez", etc
  rows: Array<{
    insurerName: string;
    value: string;
    advantage?: "win" | "lose" | "neutral";
  }>;
}

export interface CompareResult {
  insurerNames: string[];
  productType: string;
  dimensions: CompareDimension[];
  summary: string;
  sources: Array<{
    insurerName: string;
    sourceUrl: string | null;
    excerpt: string;
  }>;
  model: string;
  latencyMs: number;
}

const SYSTEM_PROMPT = `Voce e SOLOMON, especialista em analise comparativa de seguros de vida no Brasil.

MISSAO: O corretor te da 2-3 seguradoras e um tipo de produto. Voce compara as condicoes gerais lado a lado.

TAREFA: Analise os documentos fornecidos e produza uma tabela comparativa com linhas para cada dimensao:
1. Cobertura morte (valor, carencia, exclusoes)
2. Cobertura invalidez (IPA, IPD, percentuais)
3. Cobertura doencas graves (CID cobertos, carencia)
4. Contestabilidade (prazo)
5. Beneficios adicionais (assistencia funeral, antecipacao)
6. Carencias criticas
7. Exclusoes principais

VOCE DEVE RETORNAR APENAS UM JSON VALIDO com este schema (sem markdown):
{
  "dimensions": [
    {
      "dimension": "Nome da dimensao (ex: 'Carencia morte natural')",
      "rows": [
        {
          "insurerName": "Prudential",
          "value": "Texto curto com o valor especifico (ex: '24 meses para morte natural')",
          "advantage": "win" | "lose" | "neutral"
        },
        {
          "insurerName": "Bradesco Seguros",
          "value": "...",
          "advantage": "lose"
        }
      ]
    }
  ],
  "summary": "Resumo executivo em 2-3 frases destacando qual seguradora se sai melhor em quais dimensoes"
}

REGRAS:
- advantage "win": esta seguradora e claramente superior nessa dimensao
- advantage "lose": esta seguradora e claramente inferior
- advantage "neutral": empate ou sem diferenca relevante
- Preencher APENAS dimensoes onde ha dados concretos nos documentos. Nao inventar.
- Se nao encontrar info de uma seguradora em uma dimensao, incluir a linha com value "Nao consta nas condicoes gerais disponiveis"
- Retornar APENAS o JSON, sem texto adicional

DOCUMENTOS DAS SEGURADORAS:
{context}`;

export async function compareInsurers(
  input: CompareInput
): Promise<CompareResult> {
  const start = Date.now();
  // Wave A.3: instrumentacao temporaria pra isolar onde compareInsurers
  // estoura em prod. Remover apos diagnosticar.
  const trace = Math.random().toString(36).slice(2, 8);
  console.log(`[compare:${trace}] START insurerNames=${JSON.stringify(input.insurerNames)} productType=${input.productType}`);

  if (input.insurerNames.length < 2 || input.insurerNames.length > 3) {
    throw new Error("Selecione 2 ou 3 seguradoras para comparar.");
  }

  // 1. Resolve ids
  console.log(`[compare:${trace}] step1 resolveInsurerIds...`);
  const idsMap = await resolveInsurerIds(input.insurerNames);
  const idsBreakdown: Record<string, number> = {};
  for (const [k, v] of idsMap) idsBreakdown[k] = v.length;
  console.log(`[compare:${trace}] step1 result size=${idsMap.size} breakdown=${JSON.stringify(idsBreakdown)}`);
  if (idsMap.size < input.insurerNames.length) {
    const missing = input.insurerNames.filter((n) => !idsMap.has(n));
    console.error(`[compare:${trace}] step1 missing=${JSON.stringify(missing)}`);
    throw new Error(`Seguradoras nao encontradas: ${missing.join(", ")}`);
  }

  // 2. Search per insurer with multi-query strategy
  const queries = [
    `${input.productType} cobertura morte natural carencia`,
    `${input.productType} invalidez permanente IPA IPD percentual`,
    `${input.productType} doencas graves DG cobertura carencia`,
    `${input.productType} contestabilidade prazo declaracoes`,
    `${input.productType} assistencia funeral antecipacao beneficio`,
    `${input.productType} exclusoes limitacoes nao cobertura`,
  ];

  console.log(`[compare:${trace}] step2 semantic search ${queries.length} queries x ${idsMap.size} insurers...`);
  const t2 = Date.now();
  const allResults = [];
  let queryCount = 0;
  for (const name of input.insurerNames) {
    const ids = idsMap.get(name) ?? [];
    for (const id of ids) {
      for (const q of queries) {
        try {
          const r = await semanticSearch(q, { insurerId: id, topK: 3 });
          allResults.push(...r);
          queryCount++;
        } catch (err) {
          console.error(`[compare:${trace}] step2 semanticSearch FAIL q="${q.slice(0, 40)}" insurerId=${id}: ${(err as Error).message}`);
          throw err;
        }
      }
    }
  }
  console.log(`[compare:${trace}] step2 done in ${Date.now() - t2}ms — ${queryCount} queries, ${allResults.length} raw results`);

  if (allResults.length === 0) {
    console.error(`[compare:${trace}] step2 ZERO results — idsBreakdown=${JSON.stringify(idsBreakdown)}`);
    throw new Error("Nao encontrei dados suficientes para comparar.");
  }

  // 3. Deduplicate by id
  const seen = new Set<string>();
  const uniqResults = allResults.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  console.log(`[compare:${trace}] step3 dedup ${allResults.length} -> ${uniqResults.length} unique`);

  // 4. Build context
  console.log(`[compare:${trace}] step4 buildContext...`);
  const t4 = Date.now();
  let contextText: string;
  let sources;
  try {
    const enrichment = await loadEnrichment(uniqResults);
    const built = buildContext(uniqResults, enrichment);
    contextText = built.contextText;
    sources = built.sources;
  } catch (err) {
    console.error(`[compare:${trace}] step4 FAIL: ${(err as Error).message}`);
    throw err;
  }
  console.log(`[compare:${trace}] step4 done in ${Date.now() - t4}ms — contextText.length=${contextText.length} sources=${sources.length}`);

  // 5. LLM call — Gemini direto (Wave A.2). Anthropic SDK saiu da chain em prod
  // por saldo morto; callGeminiJson usa responseMimeType=application/json e
  // valida GEMINI_API_KEY internamente.
  const userMessage = `Compare estas seguradoras para ${input.productType}:

${input.insurerNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Produto: ${humanizeProductType(input.productType)}

Retorne JSON estruturado com as dimensoes comparativas.`;

  const systemPrompt = SYSTEM_PROMPT.replace("{context}", contextText);

  console.log(`[compare:${trace}] step5 callGeminiJson model=${COMPARE_MODEL} systemLen=${systemPrompt.length} userLen=${userMessage.length}`);
  const t5 = Date.now();
  let completion;
  try {
    completion = await callGeminiJson(systemPrompt, userMessage, {
      model: COMPARE_MODEL,
      temperature: 0.2,
      maxOutputTokens: 3000,
    });
  } catch (err) {
    console.error(`[compare:${trace}] step5 FAIL after ${Date.now() - t5}ms: ${(err as Error).message}`);
    throw err;
  }
  console.log(`[compare:${trace}] step5 done in ${Date.now() - t5}ms — responseLen=${completion.text.length} model=${completion.model}`);

  const parsed = extractJson<{
    dimensions?: CompareDimension[];
    summary?: string;
  }>(completion.text);
  if (!parsed) {
    console.error(`[compare:${trace}] step6 JSON parse failed. Raw:`, completion.text.slice(0, 800));
    throw new Error("LLM retornou resposta invalida.");
  }
  console.log(`[compare:${trace}] step6 parsed OK dimensions=${(parsed.dimensions ?? []).length} hasSummary=${!!parsed.summary}`);

  return {
    insurerNames: input.insurerNames,
    productType: input.productType,
    dimensions: parsed.dimensions ?? [],
    summary: parsed.summary ?? "",
    sources: sources.slice(0, 10).map((s) => ({
      insurerName: s.insurerName,
      sourceUrl: s.sourceUrl,
      excerpt: s.content.slice(0, 250),
    })),
    model: completion.model,
    latencyMs: Date.now() - start,
  };
}

function humanizeProductType(t: string): string {
  const map: Record<string, string> = {
    vida_individual: "Vida Individual",
    vida_em_grupo: "Vida em Grupo",
    vida_temporario: "Vida Temporario",
    vida_vitalicio: "Vida Vitalicio",
  };
  return map[t] ?? t;
}

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
    try {
      return JSON.parse(raw.slice(first, last + 1)) as T;
    } catch {}
  }
  return null;
}
