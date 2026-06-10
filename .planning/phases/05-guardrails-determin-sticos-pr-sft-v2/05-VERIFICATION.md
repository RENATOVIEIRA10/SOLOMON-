---
phase: 05-guardrails-determin-sticos-pr-sft-v2
verified: 2026-06-10T23:45:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
gaps: []
---

# Phase 5: Guardrails Determinísticos pré-SFT v2 — Verification Report

**Phase Goal:** Engenharia de confiabilidade exigida pelo gate SFT v2: eliminar por construção as 4 classes de falha observadas nos candidatos (cálculo errado de unidade, fonte de seguradora errada, fuga de domínio, presunção de cobertura) e criar held-out set novo. Nenhum novo fine-tuning até esta fase passar.
**Verified:** 2026-06-10T23:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Nenhum path de resposta em que o LLM faz aritmética de prêmio — cálculo só via rate-lookup.ts com unidade validada (caso H01 passa por construção) | VERIFIED | `assertRateUnit` em rate-lookup.ts linha 739; chamada na boundary `queryRateTable` (linha 573) + defesa em profundidade em `formatCapitalPremiumLine` (linha 803); flag `llmArithmeticBlocked = rateIntentDetected \|\| detectRateIntent(question).hasIntent` em answer.ts linha 585 e stream.ts linha 284 — cobre 0, 1 e 2+ seguradoras; seção `PROIBIDO (GRD-01)` injetada em ambos os paths; 16/16 testes passam |
| 2 | Pergunta sobre seguradora sem fonte indexada correspondente retorna recusa explícita, não resposta inventada (caso H05) | VERIFIED | GRD-02 em answer.ts linhas 531–548: condição `!hasMatch` (sem `requestedIds.size > 0` — fix WR-01) cobre tanto seguradora ausente da tabela `insurers` quanto mismatch de chunks; paridade em stream.ts linhas 236–255; modelo retorna `insurer-source-guard` com recusa explícita |
| 3 | Pergunta fora do domínio vida/pessoas (auto, residencial, viagem) é recusada antes da geração (caso H09) | VERIFIED | `detectOutOfDomainQuery` em domain-guard.ts com 2 camadas: EXPLICIT_PRODUCT_PATTERNS (bloqueia sempre) e CONTEXTUAL_PATTERNS (suprimido por LIFE_CONTEXT_RE — fix CR-01); early-return em answer.ts linha 179 (antes do fast-path) e stream.ts linha 82; 24/24 testes passam incluindo 7 casos NOT-blocked de vida/AP com menção a veículo |
| 4 | Pré-sinistro sem cláusula aplicável de cobertura nem exclusão retorna RISCO/inconclusivo sempre (caso H11) | VERIFIED | Post-validation block em pre-sinistro.ts linhas 284–307 com 3 downgrades para RISCO confirmados; `export function hasEvidenceFor` (linha 495) permite teste direto; 7/7 testes passam — chunk genérico sem keywords retorna false em ambos hasEvidenceFor → veredicto conclusivo impossível por construção; rationale sem texto sintético confirmado |
| 5 | Held-out safety set novo versionado em app/eval/, sem paráfrases do treino SFT, rodável como suíte de gate | VERIFIED | `solomon-guardrails-heldout.jsonl` com 12 casos G-01..G-12; validator `validate-heldout.cjs` passa (exit 0) com distribuição correta (calculation=3, missing_source=2, scope=3, pre_sinistro=2, contract_concept=2); README com mapeamento G->GRD e comando `compare-bedrock-sft.py`; cenários, valores e seguradoras distintos dos casos H01/H05/H09/H11/H19 |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/src/services/rag/rate-lookup.ts` | assertRateUnit() + chamada em formatCapitalPremiumLine | VERIFIED | `KNOWN_RATE_UNITS` Set + `export function assertRateUnit` linha 739; chamada em `formatCapitalPremiumLine` linha 803 (primeira linha do corpo) + call boundary `queryRateTable` linha 573 com filter+degradação (WR-03 fix) |
| `app/src/services/rag/answer.ts` | flag llmArithmeticBlocked + GRD-02 + GRD-03 early-returns | VERIFIED | `detectOutOfDomainQuery` linha 179 (GRD-03); `!hasMatch` sem guard de size linha 539 (GRD-02 pós WR-01); `llmArithmeticBlocked = rateIntentDetected \|\| detectRateIntent(question).hasIntent` linha 585 (pós WR-02); seção PROIBIDO (GRD-01) linha 594 |
| `app/src/services/rag/stream.ts` | mesmas flags/guards espelhados para path SSE | VERIFIED | Paridade confirmada com answer.ts: GRD-03 linha 82, GRD-02 linhas 237–255, `llmArithmeticBlocked` linha 284 com `detectRateIntent(question).hasIntent` global (WR-02) |
| `app/src/services/rag/domain-guard.ts` | detectOutOfDomainQuery + refusalMessageForDomain | VERIFIED | Arquivo criado com 2-camada EXPLICIT_PRODUCT_PATTERNS + CONTEXTUAL_PATTERNS suprido por LIFE_CONTEXT_RE (pós CR-01); escapes unicode explícitos `̀-ͯ` (pós WR-05) |
| `app/src/services/rag/pre-sinistro.ts` | hasEvidenceFor exportada + post-validation block intacto | VERIFIED | `export function hasEvidenceFor` linha 495; 3 downgrades para RISCO em linhas 285, 293, 301; rationale sem concatenação de texto sintético |
| `app/scripts/phase2/rate-unit-guard.test.ts` | suite H01: 560/mes, 6720/ano, nunca 5600 | VERIFIED | 16/16 testes passam — 7 assertRateUnit + 4 invariantes H01 (formato production via `formatRateAnswer`) + 5 inversão mensal/anual; implementação via API pública de produção (pós WR-04) |
| `app/scripts/phase2/domain-guard.test.ts` | detectOutOfDomainQuery: H09 + falso-positivo de vida | VERIFIED | 24/24 testes passam — inclui 7 casos CR-01 NOT-blocked (vida com veículo), G-06 (franquia carro), input acentuado NFC |
| `app/scripts/phase2/pre-sinistro-h11-guard.test.ts` | hasEvidenceFor H11: chunk genérico → ambos false | VERIFIED | 7/7 testes passam — 4 casos básicos + 3 assertions combinadas H11 |
| `app/eval/fine_tuning/solomon-guardrails-heldout.jsonl` | 12 casos G-*, schema id/category/question/ground_truth | VERIFIED | validate-heldout.cjs: exit 0, 12 casos, distribuição correta |
| `app/eval/fine_tuning/README-guardrails-heldout.md` | README com mapeamento G->GRD + comando compare-bedrock-sft.py | VERIFIED | Contém tabela mapeamento G-01..G-12 para GRD-01..GRD-05 + comando harness na VPS |
| `app/scripts/phase2/validate-heldout.cjs` | validador CJS: schema + contagem por categoria | VERIFIED | Executa via `node` sem transpilação, exit 0, output correto |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| answer.ts | detectOutOfDomainQuery | import `./domain-guard`, chamada linha 179 ANTES do fast-path | WIRED | GRD-03 posicionado antes de `detectRateIntent` (linha ~210) — early-return antes do retrieval |
| answer.ts | insurer-source-guard | `!hasMatch` após `loadEnrichment` linha 529 | WIRED | Fix WR-01: condição sem `requestedIds.size > 0`, cobre seguradora ausente do DB |
| answer.ts | systemPrompt PROIBIDO | `llmArithmeticBlocked` flag + concatenação ao promptTemplate | WIRED | Fix WR-02: `rateIntentDetected \|\| detectRateIntent(question).hasIntent` cobre 0 e 2+ seguradoras |
| stream.ts | detectOutOfDomainQuery | import `./domain-guard`, chamada linha 82 | WIRED | Paridade com answer.ts, yield token+meta+return |
| stream.ts | insurer-source-guard | `!hasMatch` após `loadEnrichment` | WIRED | Paridade com answer.ts, fix WR-01 aplicado |
| stream.ts | systemPrompt PROIBIDO | `llmArithmeticBlocked` linha 284 | WIRED | Fix WR-02 aplicado, mesmo padrão que answer.ts |
| rate-lookup.ts formatCapitalPremiumLine | assertRateUnit | chamada inline linha 803 (primeira linha do corpo) | WIRED | Defesa em profundidade para chamadas diretas do formatter |
| rate-lookup.ts queryRateTable | assertRateUnit | filter com try/catch linha 571–577 | WIRED | Fix WR-03: degradação segura — linha inválida descartada, never 500 |
| heldout.jsonl | compare-bedrock-sft.py | flag `--questions` com schema id/category/question/ground_truth | WIRED | Schema compatível confirmado; README documenta invocação |

---

### Data-Flow Trace (Level 4)

N/A — os artefatos desta fase são guardrails determinísticos (funções de controle de fluxo, não componentes de renderização de dados dinâmicos). Não há estado de UI ou fetch que precise de rastreamento de fluxo de dados. Os testes automatizados cobrem o comportamento de saída de cada guardrail via API pública de produção.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| GRD-01: assertRateUnit + H01 arithmetic (rate-unit-guard.test.ts) | `npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/rate-unit-guard.test.ts` | 16 passed, exit 0 | PASS |
| GRD-03 + CR-01: domain guard (domain-guard.test.ts) | `npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/domain-guard.test.ts` | 24 passed, 0 failed, exit 0 | PASS |
| GRD-04: H11 pre-sinistro guard (pre-sinistro-h11-guard.test.ts) | `npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/pre-sinistro-h11-guard.test.ts` | 7 passed, exit 0 | PASS |
| GRD-05: held-out set validator | `node scripts/phase2/validate-heldout.cjs` | OK, 12 casos, distribuição correta, exit 0 | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| GRD-01 | 05-01-PLAN.md | Cálculo de prêmio/taxa via código determinístico com validação de unidades — nenhum path em que LLM faz aritmética de prêmio | SATISFIED | assertRateUnit + KNOWN_RATE_UNITS em rate-lookup.ts; llmArithmeticBlocked em answer.ts e stream.ts cobrindo 0/1/2+ seguradoras; 16/16 testes |
| GRD-02 | 05-02-PLAN.md | Resposta bloqueada quando chunks recuperados não correspondem à seguradora/produto pedidos — sem fallback silencioso para fonte errada | SATISFIED | GRD-02 em answer.ts linha 531 e stream.ts linha 236; condição `!hasMatch` (pós WR-01) cobre seguradora ausente do DB; modelo `insurer-source-guard` |
| GRD-03 | 05-02-PLAN.md | Fronteira de domínio vida/pessoas imposta ANTES da geração — auto/residencial/outros recebem recusa padronizada | SATISFIED | domain-guard.ts com 2-camada (EXPLICIT + CONTEXTUAL com LIFE_CONTEXT_RE); early-return em answer.ts linha 179 e stream.ts linha 82; 24/24 testes passam |
| GRD-04 | 05-03-PLAN.md | Pré-sinistro força veredicto RISCO/inconclusivo quando nem cobertura nem exclusão têm cláusula aplicável — presunção de cobertura impossível por construção | SATISFIED | Post-validation block 3 downgrades para RISCO (linhas 284–307); hasEvidenceFor exportada e testada; 7/7 testes |
| GRD-05 | 05-04-PLAN.md | Held-out safety set novo criado (não-paráfrase dos exemplos de treino SFT), com casos críticos re-expressos + casos novos, versionado em app/eval/ | SATISFIED | solomon-guardrails-heldout.jsonl 12 casos G-01..G-12; validate-heldout.cjs exit 0; README com harness; cenários distintos dos H* |

---

### Anti-Patterns Found

Nenhum blocker ou warning relevante encontrado no estado pós-fix. Itens NOT ADDRESSED no REVIEW.md são de classificação INFO (otimizações sem impacto de corretude):

| Arquivo | Item | Severity | Impacto |
|---------|------|----------|---------|
| answer.ts (linhas 224, 330, 384, 533) | IN-02: `resolveInsurerIds` chamado até 4x por request | INFO | Otimização de IO, sem impacto de corretude nos guardrails |
| pre-sinistro.ts linha 471 | IN-03: `COVERAGE_KEYWORDS` contém "paga", substring de "nao paga" | INFO | Lógica pré-existente não alterada pela fase; hasEvidenceFor agora testável para endurecimento futuro |
| stream.ts linha 204 vs answer.ts linha 344 | IN-05: divergência `sourceType` em busca dirigida por rate intent | INFO | Divergência pré-existente (não introduzida pela fase), comportamento diferente entre /api/ask e /api/ask/stream para rate intent sem fast-path |

Os três itens INFO foram explicitamente marcados como NOT ADDRESSED no REVIEW.md ("fora do escopo desta iteração de fix") e não afetam a corretude dos guardrails GRD-01..GRD-05.

---

### Human Verification Required

Nenhum item requer verificação humana. Os guardrails são determinísticos (código, não probabilísticos), os testes automatizados cobrem todos os casos críticos via API pública de produção, e o held-out set é um artefato estático com schema validado por script.

O único item que requer ação humana futura (fora do escopo desta fase): execução do harness `compare-bedrock-sft.py` na VPS com o baseline guarded antes do SFT v2 — conforme documentado no README-guardrails-heldout.md.

---

### Gaps Summary

Nenhum gap. Todos os 5 critérios de sucesso do ROADMAP foram verificados no código atual (estado pós-commits c58b684, bc12fbc, 2803659, 71b0d04). O code review encontrou 1 critical + 5 warnings, todos corrigidos antes desta verificação. Os 3 itens INFO (IN-02, IN-03, IN-05) são fora do escopo desta fase e não bloqueiam o objetivo de eliminar por construção as 4 classes de falha.

---

_Verified: 2026-06-10T23:45:00Z_
_Verifier: Claude (gsd-verifier)_
