# Phase 5: Guardrails Determinísticos pré-SFT v2 - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 7 (6 source + 1 eval script)
**Analogs found:** 7 / 7 — todos os arquivos alvo são os próprios analogs; a fase modifica código existente, não cria arquivos novos.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `app/src/services/rag/answer.ts` | orchestrator | request-response | itself (1290 lines, existing) | exact — insert guardrails at steps 0a/1 |
| `app/src/services/rag/stream.ts` | orchestrator-sse | request-response | `answer.ts` (mirrored flow) | exact — mirrors answer.ts fast-path |
| `app/src/services/rag/rate-lookup.ts` | utility | transform | itself (798 lines) | exact — add unit-validation helper |
| `app/src/services/rag/pre-sinistro.ts` | service | request-response | itself (653 lines) | exact — post-validation block already present |
| `app/src/services/rag/search.ts` | utility | CRUD | itself (829 lines) | exact — insurer_id already on SearchResult |
| `app/src/services/rag/compare.ts` | service | request-response | itself (243 lines) | exact — domain-guard insertion point |
| `app/eval/fine_tuning/solomon-guardrails-heldout.jsonl` | eval artifact | batch | `solomon-nova-pro-critical-comparison.jsonl` | exact |

---

## Pattern Assignments

### GRD-01 — `app/src/services/rag/answer.ts` + `stream.ts`
**Role:** orchestrator | **Data Flow:** request-response
**Guardrail:** fechar path onde LLM ainda faz aritmética de prêmio quando fast-path falha (rateRows vazio → RAG → LLM calcula).

#### Insertion point — `ask()` (answer.ts line ~292-295)

```typescript
// Ponto de fall-through do rate fast-path (after rateRows.length === 0 check)
// ANTES da expansão de query e do RAG normal.
// GRD-01: se rateIntentDetected === true mas rateRows vazio, injetar
// aviso no systemPrompt proibindo aritmética de prêmio:
if (rateIntentDetected && rateRows.length === 0) {
  console.log(`[rag/ask] Rate fast-path MISS — no rows, falling through to RAG.`)
  // INSERT: flag para adicionar instrução anti-aritmética ao systemPrompt
}
```

O systemPrompt já é montado em `answer.ts` linhas 548-552:
```typescript
let promptTemplate = compareIntent ? SYSTEM_PROMPT_COMPARE_TEMPLATE : SYSTEM_PROMPT_TEMPLATE
if (options?.channel === 'whatsapp') {
  promptTemplate = stripSourcesSection(promptTemplate)
}
const systemPrompt = promptTemplate.replace('{context}', contextText || 'Nenhum documento encontrado.')
```

**Pattern a copiar:** a variável `promptTemplate` já é condicional — o mesmo `if/else` deve receber uma terceira ramificação para `rateIntentDetected && rateRows.length === 0`, adicionando uma seção `PROIBIDO: não realize nenhuma aritmética de prêmio/taxa`.

#### Análogo em stream.ts (linhas 80-167)

```typescript
// stream.ts espelha exatamente o fast-path de answer.ts (linhas 81-167).
// A mesma flag rateIntentDetected deve ser propagada antes de chamar callLLMStream.
if (mentionedInsurers.length === 1) {
  const intent = detectRateIntent(question, mentionedInsurers[0])
  if (intent.hasIntent) {
    // ... queryRateTable ...
    if (rateRows.length > 0) {
      // fast-path: yield token + meta e return
    }
    // GRD-01: se rateRows.length === 0, setar flag para restringir prompt abaixo
  }
}
```

#### Validação de unidades em `rate-lookup.ts` — `formatCapitalPremiumLine` (linhas 771-776)

```typescript
function formatCapitalPremiumLine(row: RateRow, capital: number): string {
  const premio = (row.rate * capital) / 1000          // taxa × capital / 1000
  const mensal = row.rate_unit === 'per_1000_monthly' ? premio : premio / 12
  const anual  = row.rate_unit === 'per_1000_monthly' ? premio * 12 : premio
  return `    Premio para capital R$ ${formatBrNumber(capital, 0)}: **R$ ${formatBrNumber(anual, 2)}/ano` +
         ` (≈ R$ ${formatBrNumber(mensal, 2)}/mes)`
}
```

**GRD-01 insertion:** adicionar função `assertRateUnit(row: RateRow, context: string): void` que lança (ou retorna `false`) se `row.rate_unit` for desconhecido, e inlinear chamada antes de `formatCapitalPremiumLine`. Padrão: seguir o estilo `if (error) { console.error(...); return [] }` já em `queryRateTable` linhas 560-563.

---

### GRD-02 — `app/src/services/rag/answer.ts` + `search.ts`
**Role:** orchestrator + utility | **Data Flow:** request-response
**Guardrail:** quando chunks recuperados não correspondem à seguradora pedida, recusar ANTES de chamar o LLM.

#### Como `insurer_id` flui (search.ts linhas 21-30):

```typescript
export interface SearchResult {
  id: string
  content: string
  similarity: number
  metadata: Record<string, unknown>
  source_url: string | null
  source_type: string
  product_id: string | null
  insurer_id: string | null   // <- UUID da seguradora do chunk
}
```

`insurer_id` está presente em cada chunk depois do `hybridSearch`. O `enrichment` (carregado em `loadEnrichment`) resolve `insurerId -> name` via `Map<string, string>`.

#### Insertion point — `ask()` após retrieval (answer.ts linha ~515-528)

```typescript
// answer.ts — após o bloco de rerank/dedupe (step 1c) e antes de loadEnrichment (step 2)
const enrichment = await loadEnrichment(searchResults)

// GRD-02: se pergunta menciona insurer X e NENHUM chunk tem insurer_id ∈ resolvedIds(X),
// retornar recusa estruturada, sem chamar callLLM.
// Padrão de retorno antecipado a copiar (answer.ts linha 562-582 — fallback LLM error):
if (searchResults.length > 0) {
  const fallbackAnswer = buildFallbackAnswer(sources)
  return {
    answer: fallbackAnswer,
    citations: [],
    sources,
    model: 'fallback',
    ...
    answerWarnings: ['IA principal indisponivel; resposta montada a partir dos trechos recuperados.'],
  }
}
```

**GRD-02 usa o mesmo `return { answer, ... }` shape de `AskResult`**. Mensagem de recusa proposta: `"Não encontrei a fonte [X] indexada. Não posso usar documentos de outra seguradora como substituto."` (tom já estabelecido no SYSTEM_PROMPT_TEMPLATE linhas 33-34).

O SYSTEM_PROMPT_TEMPLATE já instrui o LLM sobre isso no passo 4 do protocolo (linhas 33-34):
```
Passo 4: Se NENHUM chunk da seguradora X aparece no contexto: responda literalmente
"Nao encontrei condicoes gerais da [X] na base para responder isso com seguranca."
```

**GRD-02 move esse check para código determinístico antes do LLM.**

---

### GRD-03 — `app/src/services/rag/answer.ts` + `stream.ts` + `compare.ts`
**Role:** orchestrator + service | **Data Flow:** request-response
**Guardrail:** classificador de domínio (vida/pessoas) ANTES de qualquer retrieval.

#### Padrão de classificação existente — `search.ts` linhas 320-322:

```typescript
// search.ts — filtro excludeNonLifeProductTypes em lexicalSearch:
if (options?.excludeNonLifeProductTypes === false) return true
const tipoProduto = String(row.metadata?.tipo_produto ?? '')
return !['PGBL', 'VGBL', 'previdencia', 'capitalizacao', 'residencial', 'viagem', 'auto'].includes(tipoProduto)
```

Esta lista é o vocabulário de domínios out-of-scope. **GRD-03 reutiliza esta lista** para um classificador de keyword/regex no nível da pergunta — antes do retrieval — seguindo o padrão de `detectRateIntent` (rate-lookup.ts linha 151):

```typescript
// rate-lookup.ts — padrão de classifier keyword:
export function detectRateIntent(question: string, insurer?: string): RateIntent {
  const q = stripAccents(question.toLowerCase())
  const hasRateKeyword = RATE_KEYWORDS.some((kw) => q.includes(kw))
  if (!hasRateKeyword) return { hasIntent: false }
  // ...keyword extraction...
}
```

**GRD-03 deve seguir este mesmo shape:**

```typescript
// NOVO em answer.ts (ou utility separado importado por answer + stream + compare)
export function detectOutOfDomainQuery(question: string): { isOutOfDomain: boolean; detectedDomain?: string } {
  const q = stripAccentsLower(question)
  const OUT_OF_DOMAIN_PATTERNS: Array<{ domain: string; patterns: RegExp }> = [
    { domain: 'auto',       patterns: /\b(seguro\s+de\s+auto|seguro\s+autom[oó]vel|carro|veiculo|ve[ií]culo|guincho)\b/ },
    { domain: 'residencial', patterns: /\b(seguro\s+residencial|casa|apto|apartamento|imovel|im[oó]vel)\b/ },
    { domain: 'viagem',     patterns: /\b(seguro\s+(de\s+)?viagem|assistencia\s+viagem)\b/ },
  ]
  for (const { domain, patterns } of OUT_OF_DOMAIN_PATTERNS) {
    if (patterns.test(q)) return { isOutOfDomain: true, detectedDomain: domain }
  }
  return { isOutOfDomain: false }
}
```

**Insertion point no `ask()`:** logo após `detectInsurers(question)` (answer.ts linha 172), antes de qualquer retrieval. Mesmo padrão de early-return já usado no rate fast-path (linhas 273-291).

---

### GRD-04 — `app/src/services/rag/pre-sinistro.ts`
**Role:** service | **Data Flow:** request-response
**Guardrail:** post-validation determinística já existe — confirmar e reforçar o bloco.

#### Post-validation block (linhas 259-317) — padrão canônico a NÃO quebrar:

```typescript
// pre-sinistro.ts linhas 279-307
// NOTA: o sinal de downgrade vai para riskFlags, NAO para rationale.
// O rationale permanece como output puro do LLM (grounded nos chunks).
// Ragas faithfulness e medida contra o rationale; texto nao-grounded aqui
// faz F cair. riskFlags sao excluidos pelo harness de eval.
if (verdict !== "RISCO" && validatedCitation === null) {
  verdict = "RISCO";
  finalConfidence = Math.min(finalConfidence, 0.45);
  riskFlags = addRiskFlag(riskFlags, "Veredicto conclusivo rebaixado: sem citacao literal validada nos chunks");
}
if (verdict === "COBERTO" && !hasEvidenceFor("COBERTO", results)) {
  verdict = "RISCO";
  finalConfidence = Math.min(finalConfidence, 0.45);
  riskFlags = addRiskFlag(riskFlags, "Downgrade automatico: veredicto COBERTO sem chunk de cobertura explicita nos documentos indexados");
}
if (verdict === "NAO_COBERTO" && !hasEvidenceFor("NAO_COBERTO", results)) {
  verdict = "RISCO";
  finalConfidence = Math.min(finalConfidence, 0.45);
  riskFlags = addRiskFlag(riskFlags, "Downgrade automatico: veredicto NAO_COBERTO sem chunk de exclusao explicita nos documentos indexados");
}
```

**GRD-04 verifica que este bloco cobre H11:** `!hasEvidenceFor("COBERTO")` AND `!hasEvidenceFor("NAO_COBERTO")` → ambos disparam downgrade para RISCO. Ou seja, "nem cobertura nem exclusão aplicável" → RISCO por construção. O bloco está correto; a ação do planner é apenas validar com um teste unitário que cobre exatamente H11 (results sem keyword de cobertura nem exclusão).

#### `addRiskFlag` (padrão helper, linha ~587-592):

```typescript
// padrão dedupe-safe para riskFlags
function addRiskFlag(flags: string[], msg: string): string[] {
  if (flags.includes(msg)) return flags
  return [...flags, msg]
}
```

**Regra PR #64 (canônica):** qualquer texto sintético de downgrade vai em `riskFlags`, NUNCA em `rationale`. O rationale é output puro do LLM. O harness Ragas exclui `riskFlags` da medição de faithfulness.

---

### GRD-05 — `app/eval/fine_tuning/solomon-guardrails-heldout.jsonl`
**Role:** eval artifact | **Data Flow:** batch
**Analog:** `app/eval/fine_tuning/solomon-nova-pro-critical-comparison.jsonl`

#### Schema exato do jsonl (cada linha é um objeto JSON):

```json
{
  "id": "H01",
  "category": "calculation",
  "question": "...",
  "ground_truth": "...",
  "fine_tuned_answer": "...",
  "production_answer": "..."
}
```

**Para o held-out safety set (GRD-05):** campos obrigatórios são `id`, `category`, `question`, `ground_truth`. Os campos `fine_tuned_answer` e `production_answer` são preenchidos pelo harness `compare-bedrock-sft.py` em runtime — o arquivo de entrada do harness contém APENAS `id`, `category`, `question`, `ground_truth`.

#### Como o harness consome o arquivo (compare-bedrock-sft.py linhas 91-99):

```python
for index, item in enumerate(questions, start=1):
    if item["id"] in completed:
        print(f"[{index:02d}] {item['id']} checkpoint", flush=True)
        continue
    fine_tuned = ask_bedrock(bedrock, args.model_id, item["question"])
    production = ask_solomon(args.endpoint, token, item["question"])
    output.append({**item, "fine_tuned_answer": fine_tuned, "production_answer": production})
    write_jsonl(args.out, output)
```

**IDs dos casos críticos existentes:** `H01`, `H05`, `H09`, `H11`, `H19` (já em `solomon-nova-pro-critical-comparison.jsonl`).

**Novos IDs para o held-out set** devem seguir sequência `H20+` ou prefixo `G-` (guardrail) para não colidir com os existentes.

**Invocação do harness:**
```bash
python app/scripts/compare-bedrock-sft.py \
  --questions app/eval/fine_tuning/solomon-guardrails-heldout.jsonl \
  --model-id <bedrock-model-id> \
  --out app/eval/fine_tuning/solomon-guardrails-heldout-comparison.jsonl \
  --endpoint https://solomonn.vercel.app/api/ask
```

---

## Shared Patterns

### Early-return antes do LLM (GRD-01 / GRD-02 / GRD-03)
**Source:** `app/src/services/rag/answer.ts` linhas 273-291 (rate fast-path hit)
```typescript
// shape de AskResult para early-return sem LLM:
return {
  answer,                          // string com recusa ou resposta determinística
  citations: [],
  sources: [],
  model: 'rate-table-lookup',      // ou 'domain-guard', 'insurer-source-guard'
  tokensUsed: 0,
  latencyMs: Date.now() - startTime,
  conversationId,
  confidenceScore: confidence,     // 1.0 para determinístico, 0.0 para recusa
  avgSimilarity: confidence,
  sourceCount: 0,
  lowConfidence: false,
  citationCoverage: 1,
  invalidCitationIndexes: [],
  answerWarnings: [],
}
```
**Apply to:** GRD-01 (rate fall-through), GRD-02 (insurer mismatch), GRD-03 (domain out-of-scope).

---

### Logging de guardrail
**Source:** `app/src/services/rag/answer.ts` linhas 200, 272, 292
```typescript
console.log(`[rag/ask] Rate intent detected — attempting fast-path. Intent:`, {...})
console.log(`[rag/ask] Rate fast-path HIT — ${rateRows.length} rows, confidence=${confidence}. Bypassing LLM.`)
console.log(`[rag/ask] Rate fast-path MISS — no rows, falling through to RAG.`)
```
**Padrão:** prefixo `[rag/ask]` ou `[rag/stream]`, sempre com `console.log`. Guardrails novos devem usar prefixo `[grd-XX]`.

---

### Keyword classifier (GRD-03 base)
**Source:** `app/src/services/rag/rate-lookup.ts` linhas 69-151 (RATE_KEYWORDS array + detectRateIntent)
```typescript
const RATE_KEYWORDS = ['taxa', 'taxas', 'premio', 'prêmio', ...]
export function detectRateIntent(question: string, insurer?: string): RateIntent {
  const q = stripAccents(question.toLowerCase())
  const hasRateKeyword = RATE_KEYWORDS.some((kw) => q.includes(kw))
  if (!hasRateKeyword) return { hasIntent: false }
  ...
}
```
**Apply to:** GRD-03 `detectOutOfDomainQuery` — mesma estrutura, mesma assinatura de retorno (`{ hasIntent/isOutOfDomain, ... }`).

---

### Downgrade de veredicto (GRD-04 base)
**Source:** `app/src/services/rag/pre-sinistro.ts` linhas 279-307
**Regra:** texto de downgrade → `riskFlags`, NUNCA → `rationale`. `finalConfidence = Math.min(finalConfidence, 0.45)` em todo downgrade.
**Apply to:** qualquer nova condição de downgrade adicionada ao bloco post-validation de `pre-sinistro.ts`.

---

## Análise dos Pontos Críticos de Inserção

### GRD-01 — gap atual em answer.ts

O fast-path (linhas 196-294) é ativado APENAS quando `mentionedInsurers.length === 1`. Cenários de gap:
1. `mentionedInsurers.length === 0` — pergunta de cálculo sem insurer → vai direto para RAG → LLM pode calcular.
2. `mentionedInsurers.length === 1` + `rateRows.length === 0` (tabela não indexada) → fall-through para RAG sem aviso → LLM recebe pergunta de cálculo livre.

**Fix pattern:** após linha 295 (`console.log Rate fast-path MISS`), setar `const llmArithmeticBlocked = rateIntentDetected` e usar essa flag na montagem do `systemPrompt` (linha 552) para injetar restrição.

### GRD-02 — gap atual em answer.ts

`mentionedInsurers` resolve via `detectInsurers()` (string canonicalizada). `resolveInsurerIds()` devolve UUID. Após `hybridSearch`, `searchResults[i].insurer_id` é o UUID do chunk. A verificação de mismatch deve ser:

```typescript
// Após loadEnrichment (line 516) e antes de buildContext (line 528):
if (mentionedInsurers.length > 0) {
  const requestedIds = new Set(
    [...(await resolveInsurerIds(mentionedInsurers)).values()].flat()
  )
  const retrievedIds = new Set(searchResults.map(r => r.insurer_id).filter(Boolean))
  const hasMatch = [...retrievedIds].some(id => requestedIds.has(id!))
  if (!hasMatch) {
    // early-return com recusa
  }
}
```

Nota: `resolveInsurerIds` já foi chamada para `insurerIds` mais acima (linha 317) — reutilizar o resultado para não duplicar a query.

### GRD-03 — gap atual: nenhuma verificação de domínio existe antes do retrieval

`excludeNonLifeProductTypes: true` (default em search.ts linha 178) filtra chunks de produtos non-life do corpus, mas **não bloqueia a pergunta**. O LLM pode receber contexto de vida e responder uma pergunta de auto/residencial com conteúdo inventado. GRD-03 precisa ser no início do `ask()`, antes de qualquer tool call.

---

## No Analog Found

Não há casos sem analog — todos os arquivos alvo existem no codebase. A fase é de modificação, não de criação.

| File | Role | Data Flow | Nota |
|---|---|---|---|
| `app/eval/fine_tuning/solomon-guardrails-heldout.jsonl` | eval artifact | batch | Novo arquivo, mas schema 100% copiado do analog existente |

---

## Metadata

**Analog search scope:** `app/src/services/rag/`, `app/eval/fine_tuning/`, `app/scripts/`
**Files scanned:** 8 (answer.ts, stream.ts, rate-lookup.ts, pre-sinistro.ts, search.ts, compare.ts, context-builder.ts, compare-bedrock-sft.py) + 2 jsonl de referência
**Pattern extraction date:** 2026-06-10
