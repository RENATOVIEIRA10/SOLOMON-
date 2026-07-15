# Pré-sinistro F0 + F1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir a qualidade do trilho de pré-sinistro — medir com correctness (gabarito Julio) sob gate de matriz de confusão, trocar o gerador para Sonnet 4.6 com fallback provider-safe, e consertar o retrieval reusando o pipeline hybrid+rerank que o oráculo já tem.

**Architecture:** F0 monta a fundação de medição (JSON caller provider-agnostic com fail-closed; harness de correctness + A/B pareado). F1 conserta a causa comprovada (retrieval de 8 chunks sem hybrid/rerank) portando `hybridSearch` + `rerankWithCohere` + multi-query, com dois valores de k e evidência por-claim. Nada liga o trilho em produção; `humanReviewRequired` permanece `true`.

**Tech Stack:** TypeScript, Next.js 16, `@anthropic-ai/sdk`, OpenRouter (gateway), pgvector (Supabase produto `ohmoyfbtfuznhlpjcbbk`), Cohere rerank. Sem test runner — harnesses standalone via `npx tsx`.

## Global Constraints

- Branch: `feat/pre-sinistro-retrieval` (já criada; master intocado).
- Testes: repo **sem runner**. Padrão = harness standalone `import assert from "node:assert/strict"` + `check(name, fn)` helper, `process.exit(passed === total ? 0 : 1)`. Rodar com `npx tsx <arquivo>.test.ts`. Testes de lógica ficam em `app/scripts/phase2/*.test.ts` (registrar npm script) — nunca importados por rotas.
- Provider: **OpenRouter-first, fail-closed**. Proibido fallback cross-provider silencioso (Sonnet nunca vai ao endpoint Gemini).
- Modelo do pré-sinistro: `anthropic/claude-sonnet-4.6`. Gemini 2.5 Flash entra **apenas** como braço de controle explícito no eval.
- Trilho **fora do piloto**: `humanReviewRequired = true` em toda análise.
- Retrieval: **reusar** `hybridSearch` / `hybridSearchWithEmbedding` / `rerankWithCohere` de `search.ts`. Não criar reranker novo.
- Dois valores de k: recuperar **24–40** candidatos, enviar ao modelo **8–12** reranqueados.
- `npm run build` (em `app/`) deve passar antes de qualquer push (pgvector/pdf-parse são sensíveis).
- Eval real (chamadas LLM) roda **na VPS**, não no notebook 16GB.

## File Structure

- `app/src/services/rag/llm-router.ts` — **novo**. `resolveProviderChain(model)` puro + `callStructuredJson()` com fail-closed. Isola a decisão de roteamento (testável sem rede) da execução.
- `app/src/services/rag/llm.ts` — **modificar**. Exportar `callAnthropicJsonDirect`; `callStructuredJson` consome `callOpenRouter` + `callAnthropicJsonDirect`.
- `app/src/services/rag/pre-sinistro.ts` — **modificar**. Trocar `callGeminiJson`→`callStructuredJson`; `PRE_SINISTRO_MODEL`; retrieval hybrid+dois-k+rerank; multi-query; `claimEvidence`; `humanReviewRequired = true`.
- `app/scripts/phase2/julio-gabarito-parser.ts` + `.test.ts` — **novo**. Parseia o MD cego do Julio.
- `app/scripts/phase2/pre-sinistro-correctness.ts` — **novo**. Harness correctness + matriz de confusão + A/B pareado (mesmo contexto).
- `app/scripts/phase2/confusion-matrix.ts` + `.test.ts` — **novo**. Matriz de confusão com custo assimétrico (lógica pura).
- `app/scripts/phase2/pre-sinistro-claim-evidence.test.ts` — **novo**. Valida chunk_ids por claim.

---

## Task 1: JSON caller provider-agnostic (fail-closed)

**Files:**
- Create: `app/src/services/rag/llm-router.ts`
- Modify: `app/src/services/rag/llm.ts` (adicionar `callAnthropicJsonDirect`)
- Test: `app/src/services/rag/llm-router.test.ts`

**Interfaces:**
- Consumes: `callOpenRouter(systemPrompt, userMessage, model, options)` e `LLMResponse` de `llm.ts`.
- Produces: `resolveProviderChain(model: string): ProviderStep[]` e `callStructuredJson(systemPrompt, userMessage, opts: StructuredJsonOptions): Promise<Omit<LLMResponse,'latencyMs'>>` onde `type ProviderStep = 'openrouter' | 'anthropic-direct' | 'gemini-direct'` e `interface StructuredJsonOptions { model: string; temperature?: number; maxOutputTokens?: number; timeoutMs?: number }`.

- [ ] **Step 1: Write the failing test** — `app/src/services/rag/llm-router.test.ts`

```ts
import assert from "node:assert/strict";
import { resolveProviderChain } from "./llm-router";

let passed = 0, total = 0;
function check(name: string, fn: () => void) { total++; fn(); passed++; console.log("ok -", name); }

// Sonnet: OpenRouter -> Anthropic direto -> fail. NUNCA gemini-direct.
check("sonnet chain is openrouter then anthropic-direct", () => {
  assert.deepEqual(resolveProviderChain("anthropic/claude-sonnet-4.6"), ["openrouter", "anthropic-direct"]);
});
// Gemini (controle): OpenRouter -> Gemini direto. NUNCA anthropic-direct.
check("gemini chain is openrouter then gemini-direct", () => {
  assert.deepEqual(resolveProviderChain("google/gemini-2.5-flash"), ["openrouter", "gemini-direct"]);
});
// Fail-closed: nenhum provider mistura o outro endpoint.
check("no cross-provider leak", () => {
  assert.ok(!resolveProviderChain("anthropic/claude-sonnet-4.6").includes("gemini-direct"));
  assert.ok(!resolveProviderChain("google/gemini-2.5-flash").includes("anthropic-direct"));
});
// Modelo desconhecido: só OpenRouter, depois falha fechado.
check("unknown model is openrouter-only", () => {
  assert.deepEqual(resolveProviderChain("mistralai/mixtral"), ["openrouter"]);
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx src/services/rag/llm-router.test.ts`
Expected: FAIL — `Cannot find module './llm-router'`.

- [ ] **Step 3: Write minimal implementation** — `app/src/services/rag/llm-router.ts`

```ts
import { callOpenRouter, callAnthropicJsonDirect, callGeminiJsonDirectPublic, type LLMResponse } from "./llm";

export type ProviderStep = "openrouter" | "anthropic-direct" | "gemini-direct";

export interface StructuredJsonOptions {
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/** Pure routing decision. Fail-closed: an anthropic/* model never routes to
 *  the gemini endpoint and vice-versa. OpenRouter is always primary. */
export function resolveProviderChain(model: string): ProviderStep[] {
  if (model.startsWith("anthropic/")) return ["openrouter", "anthropic-direct"];
  if (model.startsWith("google/")) return ["openrouter", "gemini-direct"];
  return ["openrouter"];
}

export async function callStructuredJson(
  systemPrompt: string,
  userMessage: string,
  opts: StructuredJsonOptions,
): Promise<Omit<LLMResponse, "latencyMs">> {
  const chain = resolveProviderChain(opts.model);
  let lastErr: Error | null = null;
  for (const step of chain) {
    try {
      if (step === "openrouter") {
        return await callOpenRouter(systemPrompt, userMessage, opts.model, {
          responseMimeType: "application/json",
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          timeoutMs: opts.timeoutMs,
        });
      }
      if (step === "anthropic-direct") {
        return await callAnthropicJsonDirect(systemPrompt, userMessage, opts.model, opts);
      }
      if (step === "gemini-direct") {
        return await callGeminiJsonDirectPublic(systemPrompt, userMessage, opts.model, opts);
      }
    } catch (e) {
      lastErr = e as Error;
      console.warn(`[llm-router] step ${step} falhou (${opts.model}):`, (e as Error).message);
    }
  }
  throw new Error(`[llm-router] fail-closed: todos os providers falharam para ${opts.model}: ${lastErr?.message}`);
}
```

- [ ] **Step 4: Add `callAnthropicJsonDirect` + expose gemini direct** in `app/src/services/rag/llm.ts`

Append near the other callers (uses the already-imported `Anthropic` from line 22). The model id passed is the OpenRouter-style `anthropic/claude-sonnet-4.6`; strip the vendor prefix for the direct SDK:

```ts
export async function callAnthropicJsonDirect(
  systemPrompt: string,
  userMessage: string,
  model: string,
  options: { temperature?: number; maxOutputTokens?: number; timeoutMs?: number } = {},
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nao configurada')
  const directModel = model.replace(/^anthropic\//, '') // claude-sonnet-4.6
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: directModel,
    max_tokens: options.maxOutputTokens ?? 4096,
    temperature: options.temperature ?? 0.2,
    system: systemPrompt + '\nResponda APENAS com JSON valido, sem markdown.',
    messages: [{ role: 'user', content: userMessage }],
  })
  const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
  const tokensUsed = (msg.usage?.input_tokens ?? 0) + (msg.usage?.output_tokens ?? 0)
  return { text, model: directModel, tokensUsed }
}

// Thin public wrapper so llm-router can reach the existing private direct-Gemini path.
export async function callGeminiJsonDirectPublic(
  systemPrompt: string,
  userMessage: string,
  model: string,
  options: GeminiJsonOptions = {},
): Promise<Omit<LLMResponse, 'latencyMs'>> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY nao configurada')
  const directModel = model.replace(/^google\//, '')
  return callGeminiJsonDirect(systemPrompt, userMessage, apiKey, directModel, options)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx tsx src/services/rag/llm-router.test.ts`
Expected: PASS — `4/4 passed`.

- [ ] **Step 6: Typecheck + commit**

Run: `cd app && npm run build` (expected: compila sem erro de tipo).

```bash
git add app/src/services/rag/llm-router.ts app/src/services/rag/llm-router.test.ts app/src/services/rag/llm.ts
git commit -m "feat(llm): callStructuredJson provider-agnostic fail-closed (F0)"
```

---

## Task 2: Wire pré-sinistro no Sonnet 4.6 + humanReview sempre

**Files:**
- Modify: `app/src/services/rag/pre-sinistro.ts` (import/caller, `PRE_SINISTRO_MODEL`, `humanReviewRequired`)

**Interfaces:**
- Consumes: `callStructuredJson` de `llm-router.ts`.
- Produces: nenhuma nova assinatura pública (mesma `analyzePreSinistro`).

- [ ] **Step 1: Trocar o caller e o modelo**

Em `pre-sinistro.ts`: substituir o import de `callGeminiJson` por `import { callStructuredJson } from "./llm-router";`. Localizar a constante `PRE_SINISTRO_MODEL` e defini-la como:

```ts
const PRE_SINISTRO_MODEL = process.env.PRE_SINISTRO_MODEL ?? "anthropic/claude-sonnet-4.6";
```

Na chamada ao LLM (a que hoje faz `await callGeminiJson(SYSTEM_PROMPT, userMessage, {...})`), trocar por:

```ts
const completion = await callStructuredJson(SYSTEM_PROMPT, userMessage, {
  model: PRE_SINISTRO_MODEL,
  temperature: 0.2,
  maxOutputTokens: 4096,
  timeoutMs: 40000, // Sonnet e mais lento que Flash
});
```

- [ ] **Step 2: Forçar `humanReviewRequired = true` fora do piloto**

Localizar (`pre-sinistro.ts:313`) o cálculo condicional e substituir por:

```ts
// Trilho fora do piloto (veredito PR #57): toda analise exige revisao humana,
// independentemente da confianca. Reavaliar quando o trilho entrar no piloto.
const humanReviewRequired = true;
```

- [ ] **Step 3: Verificar que o build compila**

Run: `cd app && npm run build`
Expected: PASS (sem erro de tipo; `callStructuredJson` retorna `{text, model, tokensUsed}` — mesmo shape que `completion.text`/`completion.model` já consumidos).

- [ ] **Step 4: Smoke na VPS (integração, 1 caso)**

Run (na VPS, worktree isolado): reusar o harness existente com 1 pergunta para confirmar que o Sonnet responde JSON válido pelo novo caminho:
`cd /root/solomon/eval-faithfulness/app && npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/pre-sinistro-faithfulness.ts` (deve logar `via OpenRouter (anthropic/claude-sonnet-4.6)` sem erro de parse).
Expected: veredictos gerados, sem exception de provider.

- [ ] **Step 5: Commit**

```bash
git add app/src/services/rag/pre-sinistro.ts
git commit -m "feat(pre-sinistro): gerador Sonnet 4.6 + humanReview sempre (fora do piloto) (F0)"
```

---

## Task 3: Parser do gabarito cego do Julio

**Files:**
- Create: `app/scripts/phase2/julio-gabarito-parser.ts`
- Test: `app/scripts/phase2/julio-gabarito-parser.test.ts`

**Interfaces:**
- Produces: `parseGabarito(md: string): GabaritoEntry[]` onde `interface GabaritoEntry { id: string; insurer: string; product: string; verdict: "COBERTO"|"NAO_COBERTO"|"RISCO"|null; decisiveClause: string|null; missingFacts: string|null; confidence: "alta"|"media"|"baixa"|null; justification: string|null }`.

- [ ] **Step 1: Write the failing test** — `app/scripts/phase2/julio-gabarito-parser.test.ts`

```ts
import assert from "node:assert/strict";
import { parseGabarito } from "./julio-gabarito-parser";

let passed = 0, total = 0;
function check(name: string, fn: () => void) { total++; fn(); passed++; console.log("ok -", name); }

const sample = `### Q47 — Prudential do Brasil · Vida Inteira
**Fatos:** Suicidio 18 meses apos contratacao.
\`RESPOSTA\` — Veredicto: NAO_COBERTO | Clausula decisiva: carencia suicidio 2 anos | Fatos ausentes: data exata | Confianca: alta | Justificativa: dentro da carencia | Doc consultado: CG v3`;

check("extracts id and verdict", () => {
  const rows = parseGabarito(sample);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "Q47");
  assert.equal(rows[0].verdict, "NAO_COBERTO");
  assert.equal(rows[0].confidence, "alta");
  assert.equal(rows[0].decisiveClause, "carencia suicidio 2 anos");
});

check("unfilled verdict is null", () => {
  const rows = parseGabarito("### Q99 — X · Y\n**Fatos:** z.\n`RESPOSTA` — Veredicto: ___ | Clausula decisiva: ___ | Confianca: ___");
  assert.equal(rows[0].verdict, null);
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx scripts/phase2/julio-gabarito-parser.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write implementation** — `app/scripts/phase2/julio-gabarito-parser.ts`

```ts
export interface GabaritoEntry {
  id: string; insurer: string; product: string;
  verdict: "COBERTO" | "NAO_COBERTO" | "RISCO" | null;
  decisiveClause: string | null; missingFacts: string | null;
  confidence: "alta" | "media" | "baixa" | null; justification: string | null;
}

const FIELD = (line: string, label: string): string | null => {
  const re = new RegExp(`${label}:\\s*([^|]+?)\\s*(?:\\||$)`, "i");
  const m = line.match(re);
  const v = m?.[1]?.trim();
  return !v || v === "___" ? null : v;
};

export function parseGabarito(md: string): GabaritoEntry[] {
  const blocks = md.split(/^###\s+/m).slice(1);
  const out: GabaritoEntry[] = [];
  for (const b of blocks) {
    const header = b.split("\n")[0];
    const idm = header.match(/^(Q\d+)\s*—\s*(.+?)\s*·\s*(.+)$/);
    if (!idm) continue;
    const respLine = b.split("\n").find((l) => l.includes("RESPOSTA")) ?? "";
    const rawVerdict = FIELD(respLine, "Veredicto");
    const verdict = rawVerdict && ["COBERTO", "NAO_COBERTO", "RISCO"].includes(rawVerdict)
      ? (rawVerdict as GabaritoEntry["verdict"]) : null;
    const rawConf = FIELD(respLine, "Confian[cç]a")?.toLowerCase().replace("é", "e") ?? null;
    const confidence = rawConf && ["alta", "media", "baixa"].includes(rawConf)
      ? (rawConf as GabaritoEntry["confidence"]) : null;
    out.push({
      id: idm[1], insurer: idm[2].trim(), product: idm[3].trim(),
      verdict, confidence,
      decisiveClause: FIELD(respLine, "Cl[aá]usula decisiva"),
      missingFacts: FIELD(respLine, "Fatos ausentes"),
      justification: FIELD(respLine, "Justificativa"),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx tsx scripts/phase2/julio-gabarito-parser.test.ts`
Expected: PASS — `2/2 passed`.

- [ ] **Step 5: Register npm script + commit**

Add to `app/package.json` scripts: `"phase2:julio-parser:test": "tsx --tsconfig scripts/tsconfig.json scripts/phase2/julio-gabarito-parser.test.ts"`.

```bash
git add app/scripts/phase2/julio-gabarito-parser.ts app/scripts/phase2/julio-gabarito-parser.test.ts app/package.json
git commit -m "feat(eval): parser do gabarito cego do Julio (F0)"
```

---

## Task 4: Matriz de confusão + harness de correctness/A-B

**Files:**
- Create: `app/scripts/phase2/confusion-matrix.ts`
- Test: `app/scripts/phase2/confusion-matrix.test.ts`
- Create: `app/scripts/phase2/pre-sinistro-correctness.ts` (harness de integração — roda na VPS)

**Interfaces:**
- Consumes: `GabaritoEntry` (Task 3), `analyzePreSinistro` (`pre-sinistro.ts`), `callStructuredJson` (controle Gemini).
- Produces: `scoreConfusion(pairs: {gold: Verdict; pred: Verdict}[]): ConfusionReport` onde `interface ConfusionReport { matrix: Record<string, Record<string, number>>; falseConclusive: number; coberto_sem_gold: number; abstentionRate: number; weightedCost: number }`.

- [ ] **Step 1: Write the failing test** — `app/scripts/phase2/confusion-matrix.test.ts`

```ts
import assert from "node:assert/strict";
import { scoreConfusion } from "./confusion-matrix";

let passed = 0, total = 0;
function check(name: string, fn: () => void) { total++; fn(); passed++; console.log("ok -", name); }

// RISCO = abstencao. O pecado grave: veredicto CONCLUSIVO errado (gold RISCO/NAO -> pred COBERTO).
check("false conclusive counts COBERTO when gold is not COBERTO", () => {
  const r = scoreConfusion([
    { gold: "COBERTO", pred: "COBERTO" },       // ok
    { gold: "NAO_COBERTO", pred: "COBERTO" },   // FALSO CONCLUSIVO (pior)
    { gold: "COBERTO", pred: "RISCO" },         // abstencao (custo baixo)
  ]);
  assert.equal(r.falseConclusive, 1);
  assert.equal(r.coberto_sem_gold, 1);
  assert.ok(r.abstentionRate > 0);
});

check("weighted cost penalizes false-conclusive heaviest", () => {
  const abst = scoreConfusion([{ gold: "COBERTO", pred: "RISCO" }]).weightedCost;
  const falseConc = scoreConfusion([{ gold: "NAO_COBERTO", pred: "COBERTO" }]).weightedCost;
  assert.ok(falseConc > abst);
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx tsx scripts/phase2/confusion-matrix.test.ts` → FAIL (módulo ausente).

- [ ] **Step 3: Write implementation** — `app/scripts/phase2/confusion-matrix.ts`

```ts
export type Verdict = "COBERTO" | "NAO_COBERTO" | "RISCO";

export interface ConfusionReport {
  matrix: Record<string, Record<string, number>>;
  falseConclusive: number;   // gold != COBERTO mas pred conclusivo errado
  coberto_sem_gold: number;  // pred COBERTO com gold != COBERTO (o pior)
  abstentionRate: number;    // fracao de pred=RISCO
  weightedCost: number;
}

// Custo assimetrico: afirmar COBERTO indevido e o mais caro; abster (RISCO) e barato.
const COST: Record<string, Record<string, number>> = {
  COBERTO:     { COBERTO: 0, NAO_COBERTO: 8, RISCO: 1 },
  NAO_COBERTO: { COBERTO: 10, NAO_COBERTO: 0, RISCO: 1 },
  RISCO:       { COBERTO: 10, NAO_COBERTO: 4, RISCO: 0 },
};

export function scoreConfusion(pairs: { gold: Verdict; pred: Verdict }[]): ConfusionReport {
  const v: Verdict[] = ["COBERTO", "NAO_COBERTO", "RISCO"];
  const matrix: Record<string, Record<string, number>> = {};
  for (const g of v) { matrix[g] = {}; for (const p of v) matrix[g][p] = 0; }
  let falseConclusive = 0, coberto_sem_gold = 0, abst = 0, cost = 0;
  for (const { gold, pred } of pairs) {
    matrix[gold][pred]++;
    cost += COST[gold][pred];
    if (pred === "RISCO") abst++;
    if (pred !== "RISCO" && pred !== gold) falseConclusive++;
    if (pred === "COBERTO" && gold !== "COBERTO") coberto_sem_gold++;
  }
  return { matrix, falseConclusive, coberto_sem_gold, abstentionRate: pairs.length ? abst / pairs.length : 0, weightedCost: cost };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx tsx scripts/phase2/confusion-matrix.test.ts` → PASS `2/2`.

- [ ] **Step 5: Harness de correctness + A/B pareado** — `app/scripts/phase2/pre-sinistro-correctness.ts`

Estrutura (roda na VPS; um único retrieval por caso, os DOIS modelos julgam o MESMO contexto):

```ts
// Para cada caso do gabarito: recupera contexto UMA vez, gera com Sonnet e com
// Gemini (controle) sobre os MESMOS chunks, compara veredicto vs gold do Julio.
import { readFileSync } from "node:fs";
import { parseGabarito } from "./julio-gabarito-parser";
import { scoreConfusion, type Verdict } from "./confusion-matrix";
import { analyzePreSinistro } from "../../src/services/rag/pre-sinistro";

// (implementacao: loop sobre parseGabarito(readFileSync(GABARITO_PATH)),
//  chamar analyzePreSinistro com PRE_SINISTRO_MODEL=sonnet e depois =gemini via
//  env override, colecionar {gold, pred} por modelo, imprimir scoreConfusion de
//  cada um lado-a-lado. Persistir JSON detalhado por-caso.)
```

Nota de calibração: o A/B pareado exige que os dois modelos vejam o mesmo contexto. Como `analyzePreSinistro` faz o retrieval internamente, a Task 5 deve expor uma opção `precomputedResults?: SearchResult[]` para injetar os mesmos chunks nos dois braços. Marcar dependência: **Task 4 finaliza depois da Task 5**.

- [ ] **Step 6: Commit (lógica pura; harness fica pronto após Task 5)**

```bash
git add app/scripts/phase2/confusion-matrix.ts app/scripts/phase2/confusion-matrix.test.ts app/scripts/phase2/pre-sinistro-correctness.ts
git commit -m "feat(eval): matriz de confusao custo-assimetrico + esqueleto A/B pareado (F0)"
```

---

## Task 5: Retrieval hybrid + dois-k + rerank no pré-sinistro (F1)

**Files:**
- Modify: `app/src/services/rag/pre-sinistro.ts` (bloco de retrieval, linhas ~142-177)

**Interfaces:**
- Consumes: `hybridSearchWithEmbedding(query, queryEmbedding, options)`, `rerankWithCohere(query, candidates, topN)`, `embedQuery` de `search.ts`.
- Produces: opção `precomputedResults?: SearchResult[]` em `PreSinistroInput` (permite o A/B pareado da Task 4 injetar o mesmo contexto).

- [ ] **Step 1: Adicionar constantes de dois-k** no topo de `pre-sinistro.ts`

```ts
const PRE_SINISTRO_FETCH_K = 32;   // recall: candidatos recuperados (24-40)
const PRE_SINISTRO_RERANK_K = 10;  // contexto: chunks enviados ao modelo (8-12)
```

- [ ] **Step 2: Substituir o retrieval** (hoje `semanticSearch` topK=8 → `.slice(0,12)`) por hybrid + rerank com dois-k. No bloco ~142-177:

```ts
const query = buildSearchQuery({ ...input, claimType: normalizedClaimType });
let results: SearchResult[];
if (input.precomputedResults) {
  results = input.precomputedResults; // A/B pareado: mesmo contexto pros 2 modelos
} else {
  const queryEmbedding = await embedQuery(query);
  const settled = await Promise.all(
    insurerIds.map((id) =>
      hybridSearchWithEmbedding(query, queryEmbedding, {
        ...corpusCtx, insurerId: id, topK: PRE_SINISTRO_FETCH_K, sourceType: "conditions_pdf",
      })
    )
  );
  const seen = new Set<string>();
  const candidates = settled.flat().filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  // rerank cross-encoder (Cohere) traz a clausula certa pro topo; fallback = similarity order
  results = await rerankWithCohere(query, candidates, PRE_SINISTRO_RERANK_K);
}
```

(Manter os guardrails a jusante intactos: productHint filter, mínimo de evidência, `loadEnrichment`, post-validation.)

- [ ] **Step 3: Adicionar `precomputedResults` ao input**

Em `PreSinistroInput` (`pre-sinistro.ts:63`): adicionar `precomputedResults?: SearchResult[];` e importar `SearchResult` (já importado via `./search`).

- [ ] **Step 4: Build + smoke retrieval na VPS**

Run: `cd app && npm run build` (expected PASS).
Run (VPS): re-rodar `pre-sinistro-faithfulness.ts` — esperado `chunks` reportado maior que antes na fase de recall, contexto final ~10.

- [ ] **Step 5: Commit**

```bash
git add app/src/services/rag/pre-sinistro.ts
git commit -m "feat(pre-sinistro): retrieval hybrid + dois-k + rerank; precomputedResults p/ A/B (F1)"
```

---

## Task 6: Multi-query decomposition (F1)

**Files:**
- Modify: `app/src/services/rag/pre-sinistro.ts`
- Test: `app/scripts/phase2/pre-sinistro-subqueries.test.ts`

**Interfaces:**
- Produces: `buildSubQueries(input: PreSinistroInput): string[]` — decompõe o caso em consultas por dimensão (cobertura, carência, exclusão, faixa etária, produto).

- [ ] **Step 1: Write the failing test** — `app/scripts/phase2/pre-sinistro-subqueries.test.ts`

```ts
import assert from "node:assert/strict";
import { buildSubQueries } from "../../src/services/rag/pre-sinistro";

let passed = 0, total = 0;
function check(name: string, fn: () => void) { total++; fn(); passed++; console.log("ok -", name); }

check("produces one query per coverage dimension", () => {
  const qs = buildSubQueries({ insurerName: "Prudential do Brasil", claimType: "morte_por_suicidio", description: "suicidio 18 meses" });
  assert.ok(qs.length >= 4);
  assert.ok(qs.some((q) => /car[eê]ncia/i.test(q)));
  assert.ok(qs.some((q) => /exclus/i.test(q)));
  assert.ok(qs.some((q) => /cobertura/i.test(q)));
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
```

- [ ] **Step 2: Run to verify it fails** — `cd app && npx tsx scripts/phase2/pre-sinistro-subqueries.test.ts` → FAIL.

- [ ] **Step 3: Implement `buildSubQueries`** (export em `pre-sinistro.ts`)

```ts
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
```

- [ ] **Step 4: Fan-out no retrieval** — na Task 5, trocar a query única pelo fan-out: para cada sub-query, `hybridSearchWithEmbedding` (embedar cada uma), unir candidatos, dedup, e um único `rerankWithCohere(queryPrincipal, candidatos, PRE_SINISTRO_RERANK_K)`. Manter `PRE_SINISTRO_FETCH_K` como teto por sub-query dividido pelo nº de sub-queries (ex: `Math.ceil(32 / subQueries.length)`), para o total de candidatos ficar ~24-40.

- [ ] **Step 5: Run test + build** — `cd app && npx tsx scripts/phase2/pre-sinistro-subqueries.test.ts` → PASS; `npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/services/rag/pre-sinistro.ts app/scripts/phase2/pre-sinistro-subqueries.test.ts app/package.json
git commit -m "feat(pre-sinistro): multi-query fan-out por dimensao de cobertura (F1)"
```

---

## Task 7: Evidência por claim (chunk_ids) (F1)

**Files:**
- Modify: `app/src/services/rag/pre-sinistro.ts` (schema do prompt, tipo `PreSinistroResult`, validação)
- Test: `app/scripts/phase2/pre-sinistro-claim-evidence.test.ts`

**Interfaces:**
- Produces: campo `claimEvidence: Array<{ claim: string; type: "apolice" | "juridico"; chunkIds: number[]; validated: boolean }>` em `PreSinistroResult`; função `validateClaimEvidence(rawClaims, chunkCount): ClaimEvidence[]`.

- [ ] **Step 1: Write the failing test** — `app/scripts/phase2/pre-sinistro-claim-evidence.test.ts`

```ts
import assert from "node:assert/strict";
import { validateClaimEvidence } from "../../src/services/rag/pre-sinistro";

let passed = 0, total = 0;
function check(name: string, fn: () => void) { total++; fn(); passed++; console.log("ok -", name); }

check("apolice claim with valid chunkIds is validated", () => {
  const out = validateClaimEvidence([{ claim: "carencia 2 anos", type: "apolice", chunkIds: [1, 3] }], 8);
  assert.equal(out[0].validated, true);
});
check("apolice claim citing out-of-range chunk is not validated", () => {
  const out = validateClaimEvidence([{ claim: "x", type: "apolice", chunkIds: [99] }], 8);
  assert.equal(out[0].validated, false);
});
check("juridico claim is always non-validated until F2 corpus", () => {
  const out = validateClaimEvidence([{ claim: "Art. 766 CC", type: "juridico", chunkIds: [] }], 8);
  assert.equal(out[0].validated, false);
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
```

- [ ] **Step 2: Run to verify it fails** — `cd app && npx tsx scripts/phase2/pre-sinistro-claim-evidence.test.ts` → FAIL.

- [ ] **Step 3: Implement `validateClaimEvidence` + tipo**

Adicionar em `pre-sinistro.ts`:

```ts
export interface ClaimEvidence { claim: string; type: "apolice" | "juridico"; chunkIds: number[]; validated: boolean }

export function validateClaimEvidence(
  raw: Array<{ claim: string; type: "apolice" | "juridico"; chunkIds: number[] }>,
  chunkCount: number,
): ClaimEvidence[] {
  return raw.map((c) => ({
    ...c,
    // claim-de-apolice: valido so se todos os chunkIds existem no contexto (1..chunkCount)
    // claim-juridico: sempre nao-validado ate corpus juridico da F2
    validated: c.type === "apolice" && c.chunkIds.length > 0 && c.chunkIds.every((i) => i >= 1 && i <= chunkCount),
  }));
}
```

Adicionar `claimEvidence: ClaimEvidence[]` a `PreSinistroResult` e ao objeto de retorno (`claimEvidence: validateClaimEvidence(parsed.claims ?? [], results.length)`).

- [ ] **Step 4: Atualizar o SYSTEM_PROMPT** para pedir claims atômicos com tipo e chunkIds:

No schema JSON do `SYSTEM_PROMPT` (`pre-sinistro.ts:82+`), adicionar ao objeto:
```
"claims": [{ "claim": "afirmacao atomica", "type": "apolice"|"juridico", "chunkIds": [numeros dos [chunk_N] que sustentam] }]
```
Com instrução: *claim de apólice DEVE citar os chunkIds que o sustentam; claim jurídico (lei/CC/SUSEP) usa type="juridico" e chunkIds vazio.*

- [ ] **Step 5: Run test + build** — test PASS; `npm run build` PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/services/rag/pre-sinistro.ts app/scripts/phase2/pre-sinistro-claim-evidence.test.ts app/package.json
git commit -m "feat(pre-sinistro): evidencia por claim (chunkIds), juridico nao-validado ate F2 (F1)"
```

---

## Dependências externas (bloqueios humanos)

- **Gabarito do Julio** (`app/eval/pre-sinistro/2026-07-15-gabarito-julio-cego.md`): a Task 4 (correctness/A-B) só produz números depois que o Julio preencher Q46–Q65. As Tasks 1–3, 5–7 não dependem disso.
- **A/B pareado + gate** rodam na VPS após Julio; a promoção do Sonnet (vs Gemini controle) é decisão pós-dados.

## Self-Review (feito)

- **Cobertura da spec:** adapter provider-agnostic (T1) ✓ · Sonnet 4.6 + humanReview (T2) ✓ · gabarito Julio (T3, + pacote já commitado) ✓ · métrica dupla/matriz/A-B (T4) ✓ · dois-k + hybrid + rerank reusados (T5) ✓ · multi-query (T6) ✓ · evidência por claim + jurídico não-validado (T7) ✓ · fail-closed (T1) ✓.
- **Ordem real:** T1→T2 (F0 código) · T3 (parser) · T5→T6→T7 (F1 retrieval/claims) · T4 fecha por último (precisa de `precomputedResults` da T5). Marcado.
- **Sem placeholders de código:** assinaturas reais (`hybridSearchWithEmbedding`, `rerankWithCohere`, `callOpenRouter`, client `Anthropic`) confirmadas no código. O único bloco descritivo (harness A/B da T4) é intencionalmente esboço porque depende da T5 + gabarito.
