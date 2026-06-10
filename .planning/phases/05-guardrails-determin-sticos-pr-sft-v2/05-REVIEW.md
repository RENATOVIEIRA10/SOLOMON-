---
phase: 05-guardrails-determin-sticos-pr-sft-v2
reviewed: 2026-06-10T22:28:37Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - app/eval/fine_tuning/README-guardrails-heldout.md
  - app/eval/fine_tuning/solomon-guardrails-heldout.jsonl
  - app/scripts/phase2/domain-guard.test.ts
  - app/scripts/phase2/pre-sinistro-h11-guard.test.ts
  - app/scripts/phase2/rate-unit-guard.test.ts
  - app/scripts/phase2/validate-heldout.cjs
  - app/src/services/rag/answer.ts
  - app/src/services/rag/domain-guard.ts
  - app/src/services/rag/pre-sinistro.ts
  - app/src/services/rag/rate-lookup.ts
  - app/src/services/rag/stream.ts
findings:
  critical: 1
  warning: 5
  info: 5
  total: 11
status: fixed
fixed_at: 2026-06-10
fix_commits:
  - c58b684  # CR-01 + WR-05 (+ IN-01/IN-04 de carona)
  - bc12fbc  # WR-01 + WR-02
  - "2803659"  # WR-03
  - 71b0d04  # WR-04
fix_notes: |
  CR-01, WR-01..WR-05 corrigidos e commitados (fix(05): ...). IN-01 e IN-04
  resolvidos como efeito colateral do CR-01 (patterns reescritos + gates novos).
  IN-02 (4x resolveInsurerIds), IN-03 ("paga" substring) e IN-05 (sourceType
  no stream) NAO foram tratados — fora do escopo do fix desta iteracao.
  Gates: domain-guard 24/24, rate-unit-guard 16/16, pre-sinistro-h11 7/7.
  npm run build OK.
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-10T22:28:37Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Revisao dos guardrails deterministicos pre-SFT v2 (GRD-01/02/03), suite heldout e testes de gate, com diff base `1bcd0535`. Verificacoes feitas:

- **pre-sinistro.ts**: confirmado via `git diff` que a UNICA mudanca foi `function hasEvidenceFor` → `export function hasEvidenceFor`. Nenhuma outra alteracao.
- **answer.ts vs stream.ts**: os tres guardrails novos (GRD-03 early-return, GRD-02 insurer-mismatch, GRD-01 `llmArithmeticBlocked`) foram inseridos de forma textualmente identica e na mesma ordem relativa nos dois caminhos. Sem divergencia nova introduzida pela fase.
- **Ordem dos guards**: GRD-03 antes do rate fast-path antes do retrieval; GRD-02 apos retrieval/enrichment e antes do trim; GRD-01 na montagem do prompt. Ordenacao correta e consistente.
- **heldout jsonl**: 12 casos, IDs unicos G-01..G-12, distribuicao bate com `validate-heldout.cjs`; aritmetica dos ground truths G-01/G-03 conferida (345/4.140 e 4.600/383,33 corretos).

Problemas encontrados: 1 critico (falso positivo deterministico no domain-guard, confirmado empiricamente com 7 perguntas in-domain bloqueadas), e 5 warnings — destacando que GRD-02 nao dispara exatamente no cenario para o qual foi desenhado (seguradora ausente da tabela `insurers`) e que GRD-01 nao cobre os proprios casos G-01/G-03 do heldout.

## Critical Issues

### CR-01: GRD-03 recusa deterministicamente perguntas legitimas de vida/AP que mencionam "veiculo", "do carro" ou "guincho"

**Fix status:** FIXED — commit `c58b684`. Patterns reestruturados em 2 camadas: EXPLICIT_PRODUCT_PATTERNS (frase explicita de produto auto/residencial/viagem bloqueia sempre, G-06 incluso) e CONTEXTUAL_PATTERNS (veiculo/guincho/colisao so bloqueia SEM vocabulario de vida — LIFE_CONTEXT_RE suprime). Os 7 falsos positivos viraram gates NOT-blocked em domain-guard.test.ts (24/24 verdes).

**File:** `app/src/services/rag/domain-guard.ts:11`
**Issue:** O pattern de `auto` inclui as alternativas isoladas `veiculo`, `do\s+carro` e `guincho`, sem exigir contexto de seguro de automovel. Morte/invalidez por acidente de transporte e o cenario canonico de AP/vida — exatamente o dominio do produto. Como o GRD-03 e um early-return ANTES do retrieval (answer.ts:180, stream.ts:83), o bloqueio e deterministico e sem fallback: o corretor recebe recusa de dominio para pergunta valida.

Confirmado empiricamente (todas retornam `isOutOfDomain=true, domain=auto`):
- "Seguro de vida cobre morte em acidente de veiculo?"
- "O seguro de vida da Prudential cobre morte em acidente de veículo?"
- "Morte acidental em colisao de veiculo e coberta pela apolice AP?"
- "Segurado faleceu ao ser atropelado por um veiculo, o AP cobre?"
- "Seguro de vida paga se o segurado morrer em acidente do carro?"
- "IPA cobre invalidez causada por capotamento do carro?"
- "A assistencia funeral inclui guincho?"

Os testes em `domain-guard.test.ts` nao cobrem essa classe (os casos in-domain testados nao mencionam veiculo/carro), entao o gate passa verde enquanto producao quebra. Impacto direto na metrica F do produto e na confianca do corretor ancora.

**Fix:** Remover as alternativas isoladas e exigir contexto de SEGURO de auto; adicionar supressao quando ha termos fortes de vida/pessoas na pergunta:
```typescript
const LIFE_CONTEXT_RE =
  /\b(seguro\s+de\s+vida|vida\s+inteira|apolice|ap\b|acidentes?\s+pessoa|invalidez|ipa|ipta|dit|doencas?\s+graves?|funeral|morte|faleceu|capital\s+segurado|segurado)\b/

const OUT_OF_DOMAIN_PATTERNS = [
  {
    domain: 'auto',
    pattern:
      /\b(seguro\s+(de\s+)?auto(movel)?|seguro\s+(do\s+)?(meu\s+)?(carro|veiculo)|franquia\s+do\s+(carro|veiculo)|meu\s+seguro\s+de\s+carro)\b/,
  },
  // residencial / viagem inalterados
]

export function detectOutOfDomainQuery(question: string): DomainCheck {
  const q = stripAccentsLower(question)
  if (LIFE_CONTEXT_RE.test(q)) return { isOutOfDomain: false } // vida/pessoas mencionado: nunca bloquear
  for (const { domain, pattern } of OUT_OF_DOMAIN_PATTERNS) {
    if (pattern.test(q)) return { isOutOfDomain: true, detectedDomain: domain }
  }
  return { isOutOfDomain: false }
}
```
E adicionar os 7 casos acima como gates "NOT blocked" em `domain-guard.test.ts`. Validar que G-06 ("franquia do meu seguro de carro") continua bloqueado.

## Warnings

### WR-01: GRD-02 nao dispara quando a seguradora mencionada NAO existe na tabela `insurers` — exatamente o cenario G-04

**Fix status:** FIXED — commit `bc12fbc`. Condicao mudou de `requestedIds.size > 0 && !hasMatch` para `!hasMatch`: seguradora detectada mas sem linha em insurers (H05/G-04) agora recusa com "Nao tenho documentos da {X} indexados...". Paridade answer.ts/stream.ts mantida.

**File:** `app/src/services/rag/answer.ts:536` (mesmo padrao em `app/src/services/rag/stream.ts:241`)
**Issue:** A condicao de recusa e `requestedIds.size > 0 && !hasMatch`. `requestedIds` vem de `resolveInsurerIds`, que consulta a tabela `insurers` do banco. Se o corretor pergunta sobre uma seguradora reconhecida pelos `INSURER_PATTERNS` (ex.: SulAmerica, caso G-04 do heldout) mas SEM linha na tabela `insurers`, `requestedIds.size === 0` e o guard e silenciosamente pulado. A busca direcionada retorna 0 chunks, o fallback global (answer.ts:369) preenche o contexto com chunks de OUTRAS seguradoras, e a unica defesa restante e o Passo 4 do system prompt (probabilistica, nao deterministica). O guard falha no seu caso de uso primario: "recusa quando fonte da seguradora pedida nao esta indexada".
**Fix:**
```typescript
if (mentionedInsurers.length > 0) {
  const requestedIds = new Set([...(await resolveInsurerIds(mentionedInsurers)).values()].flat())
  const retrievedIds = new Set(searchResults.map((r) => r.insurer_id).filter((id): id is string => Boolean(id)))
  const hasMatch = [...retrievedIds].some((id) => requestedIds.has(id))
  // requestedIds.size === 0 => seguradora detectada na pergunta mas inexistente no DB: recusar tambem
  if (!hasMatch) {
    // ... recusa insurer-source-guard
  }
}
```
Aplicar a mesma correcao nos dois arquivos (answer.ts e stream.ts) para manter paridade.

### WR-02: GRD-01 so dispara para pergunta com exatamente 1 seguradora — nao cobre os proprios casos G-01/G-03 do heldout

**Fix status:** FIXED — commit `bc12fbc`. `llmArithmeticBlocked = rateIntentDetected || detectRateIntent(question).hasIntent` nos dois caminhos — intent global (sem insurer) cobre 0 e 2+ seguradoras; fast-path deterministico segue restrito a 1. Gating de detectRateIntent ja exige qualifier, evitando disparo em perguntas conceituais.

**File:** `app/src/services/rag/answer.ts:209,577` (mesmo padrao em `app/src/services/rag/stream.ts:97,276`)
**Issue:** `rateIntentDetected` so e calculado dentro de `if (mentionedInsurers.length === 1)`. Consequencias: (a) pergunta de premio SEM seguradora ("a taxa mensal e 2,3 por R$ 1.000 e o capital e R$ 150.000, qual o premio?") nunca recebe a injecao "PROIBIDO (GRD-01)" — e esse e exatamente o formato de G-01 e G-03, que o README mapeia para GRD-01; (b) pergunta de premio com 2+ seguradoras ("compare o premio Prudential vs MAG, homem 40 anos, 500 mil") tambem fica sem o bloqueio de aritmetica. Nos dois casos o LLM fica livre para fazer a conta — incluindo a inversao mensal/anual e a "conversao de centavos" (bug H01) que a fase quis eliminar. O gate heldout pode reprovar o baseline guarded por um guard que existe mas nao alcanca o caso.
**Fix:** Calcular o intent de taxa independentemente do numero de seguradoras, usando-o apenas para o flag do prompt (o fast-path continua restrito a 1 seguradora):
```typescript
// fora do if (mentionedInsurers.length === 1):
const globalRateIntent = detectRateIntent(question) // sem insurer: PRODUCT_FAMILIES sem filtro
const llmArithmeticBlocked = rateIntentDetected || globalRateIntent.hasIntent
```
Validar que isso nao degrada respostas conceituais ("o que e taxa de carregamento?") — o gating de `detectRateIntent` ja exige qualifier (idade/capital/produto), o que mitiga.

### WR-03: assertRateUnit e inalcancavel no unico call site e, se algum dia disparar, derruba a request em `ask()` (500) em vez de degradar para RAG

**Fix status:** FIXED — commit `2803659`. Validacao movida para o call boundary em `queryRateTableSingle`: linha com rate_unit desconhecido e filtrada com console.error; se nada sobrar, fast-path da MISS e cai no RAG com GRD-01. Failure mode identico em ask()/askStream(). assertRateUnit mantido no formatter como defesa em profundidade.

**File:** `app/src/services/rag/rate-lookup.ts:788` (call sites: 647 e 761)
**Issue:** Dois problemas combinados. (1) `formatCapitalPremiumLine` so e chamado sob a condicao `r.rate_unit === 'per_1000_annual' || r.rate_unit === 'per_1000_monthly'` (linhas 647 e 761) — ambas unidades conhecidas. Logo o `assertRateUnit` dentro dela nunca pode lancar no codigo atual: a protecao de runtime do GRD-01 contra `rate_unit` desconhecido vindo do banco e codigo morto no fluxo real. (2) Se um refactor futuro tornar o throw alcancavel, em `ask()` a excecao sobe sem catch ate a rota (`formatRateAnswer` e chamado fora de try/catch em answer.ts:261) → resposta 500 para o corretor; em `askStream` ela cai no try/catch geral e vira evento `error` no SSE. Failure modes divergentes entre os dois caminhos, e em ambos o resultado e abortar em vez do fall-through para RAG que o fast-path promete.
**Fix:** Mover a validacao para antes da decisao de servir o fast-path, filtrando linhas invalidas em vez de lancar:
```typescript
// em ask()/askStream, apos queryRateTable:
const validRows = rateRows.filter((r) => {
  try { assertRateUnit(r.rate_unit, 'rate-fast-path'); return true }
  catch (e) { console.error((e as Error).message); return false }
})
if (validRows.length > 0) { /* fast-path com validRows */ }
// senao: fall-through para RAG com GRD-01 injetado (rateIntentDetected ja true)
```
Assim o guard fica alcancavel, deterministico e degrada com seguranca em vez de quebrar a request.

### WR-04: gateH01Arithmetic em rate-unit-guard.test.ts e tautologico — nunca exercita o codigo de producao

**Fix status:** FIXED — commit `71b0d04`. Gate reescrito sobre `formatRateAnswer` (API publica de producao): asserta 560,00/mes + 6.720,00/ano para per_1000_monthly e 560,00/ano + 46,67/mes para per_1000_annual, com invariantes negativos (5.600,00/mes, 56.000,00, inversao mensal/anual). 16/16 verdes.

**File:** `app/scripts/phase2/rate-unit-guard.test.ts:75-95`
**Issue:** O "teste de regressao H01" recalcula a formula localmente no proprio teste (`const mensal = (rate * capital) / 1000`) e asserta sobre essa variavel local. Ele passa para sempre, independentemente de qualquer mudanca em `formatCapitalPremiumLine`/`formatRateAnswer` — inclusive se alguem reintroduzir a inversao mensal/anual ou a conversao de centavos em producao. E um gate que da falso-verde por construcao.
**Fix:** Testar via API publica `formatRateAnswer` (ja exportada), assertando o texto final:
```typescript
import { formatRateAnswer } from '@/services/rag/rate-lookup'
const out = formatRateAnswer({
  insurerName: 'MAG',
  intent: { hasIntent: true, age: 40, gender: 'M', capital: 320000 },
  rows: [{ product_name: 'VIDA INTEIRA', product_code: '3082', portfolio: null,
    coverage_type: 'morte', gender: 'M', age: 40, period: null, rate: 1.75,
    rate_unit: 'per_1000_monthly', source_doc_name: 'doc.pdf', source_page: 1, version_label: null }],
})
ok('H01 mensal 560 presente', out.includes('560,00'))
ok('H01 nao contem 5.600 mensal', !/5\.600,00\/mes/.test(out))
ok('H01 anual 6.720 presente', out.includes('6.720,00'))
```

### WR-05: regex de strip de acentos usa combining chars literais invisiveis — fragil num repo com historico de corrupcao de encoding

**Fix status:** FIXED — commit `c58b684`. Char class agora usa escapes unicode ASCII explicitos (u0300-u036f, com backslash no fonte; verificado em nivel de bytes que nenhum combining char literal restou). Gate novo com input acentuado NFC ("seguro de automóvel" → auto) em domain-guard.test.ts.

**File:** `app/src/services/rag/domain-guard.ts:4`
**Issue:** A char class e `[U+0300-U+036F]` escrita com os caracteres combinantes LITERAIS no fonte (verificado por inspecao de codepoints: U+0300, U+002D, U+036F). Funciona hoje, mas e invisivel no editor e vulneravel a re-encoding/normalizacao — e este repo JA exibe mojibake em `pre-sinistro.ts` ("PrÃ©-Sinistro", "â€”" nos comentarios), prova de que corrupcao de encoding acontece aqui. Se esses bytes forem corrompidos, o strip de acentos para de funcionar silenciosamente e "veículo"/"automóvel" acentuados passam a furar o guard (nenhum teste cobre input acentuado em forma NFC tipica de mobile). Todos os outros arquivos do modulo usam escapes explicitos (`answer.ts:878`, `pre-sinistro.ts:464`).
**Fix:**
```typescript
function stripAccentsLower(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
```
E adicionar 1 gate no teste com input acentuado: `detectOutOfDomainQuery('Quanto custa seguro de automóvel?')` → `auto`.

## Info

### IN-01: Alternativas mortas nos patterns do domain-guard

**Fix status:** RESOLVED (de carona no CR-01, commit `c58b684`) — patterns reescritos; alternativas redundantes eliminadas na reestruturacao.

**File:** `app/src/services/rag/domain-guard.ts:11,21`
**Issue:** `colisao\s+de\s+veiculo` nunca decide nada porque a alternativa isolada `veiculo` ja casa antes; `seguro\s+viagem` (3a alternativa do pattern viagem) e identica ao caso sem `de` da 1a alternativa `seguro\s+(de\s+)?viagem`.
**Fix:** Remover as alternativas redundantes ao aplicar o CR-01 (a remocao de `veiculo` isolado torna `colisao de veiculo` relevante de novo — manter nesse caso).

### IN-02: resolveInsurerIds chamado ate 4x por request em ask() — o GRD-02 adiciona a 4a

**Fix status:** NOT ADDRESSED — fora do escopo desta iteracao de fix (otimizacao, sem impacto de corretude).

**File:** `app/src/services/rag/answer.ts:224,330,384,533`
**Issue:** Cada chamada faz `select id, name` completo na tabela `insurers`. O GRD-02 re-resolve nomes ja resolvidos no passo de busca. Duplicacao de codigo/IO e risco de divergencia se a logica de matching mudar num ponto e nao no outro.
**Fix:** Resolver uma vez no inicio de `ask()`/`askStream` (`const insurerIds = mentionedInsurers.length > 0 ? await resolveInsurerIds(mentionedInsurers) : new Map()`) e reusar nas 4 ocorrencias.

### IN-03: COVERAGE_KEYWORDS contem "paga", substring de "nao paga" — chunk de exclusao conta como evidencia de COBERTO

**Fix status:** NOT ADDRESSED — pre-sinistro.ts intocado por instrucao explicita do fix desta iteracao.

**File:** `app/src/services/rag/pre-sinistro.ts:471-488`
**Issue:** `hasEvidenceFor('COBERTO', ...)` usa `head.includes('paga')`; um chunk contendo apenas "a seguradora nao paga nos seguintes casos" satisfaz a checagem de cobertura (e tambem a de exclusao via "nao paga"). Logica pre-existente — a fase so exportou a funcao — mas agora ela esta pinada por teste de gate (GRD-04), entao vale endurecer.
**Fix:** Checar negacao adjacente, ex.: `/\b(?<!nao\s)paga\b/` ou remover "paga" e manter "indeniza"/"cobertura"/"capital segurado", adicionando caso de teste com chunk "nao paga" que deve retornar false para COBERTO.

### IN-04: Suite do domain-guard nao cobre a classe de falso positivo de maior risco

**Fix status:** RESOLVED (de carona no CR-01, commit `c58b684`) — 7 gates NOT-blocked + caso acentuado + G-06 adicionados.

**File:** `app/scripts/phase2/domain-guard.test.ts:53-68`
**Issue:** Os 3 casos in-domain testados ("cobertura de morte", "invalidez por acidente", "carencia") nao mencionam veiculo/carro/viagem — justamente a fronteira que o guard pode errar. O CR-01 teria sido pego no gate com 1 caso adicional.
**Fix:** Adicionar os casos listados no CR-01 como gates `NOT blocked`, mais 1 caso acentuado (ver WR-05).

### IN-05: stream.ts nao restringe retrieval a rate_table_pdf quando rate intent detectado (answer.ts restringe)

**Fix status:** NOT ADDRESSED — divergencia pre-existente, fora do escopo desta iteracao de fix.

**File:** `app/src/services/rag/stream.ts:204` vs `app/src/services/rag/answer.ts:344`
**Issue:** Divergencia pre-existente (nao introduzida pela fase, mas agora mais relevante): em answer.ts a busca direcionada usa `sourceType: rateIntentDetected ? 'rate_table_pdf' : undefined`; em stream.ts o mesmo cenario (rate intent sem fast-path) busca em todos os source types. Com GRD-01 injetado nos dois caminhos, o contexto que o LLM recebe difere entre /api/ask e /api/ask/stream para a mesma pergunta de premio.
**Fix:** Passar o mesmo `sourceType` condicional na busca direcionada de stream.ts, ou documentar a divergencia como intencional.

---

_Reviewed: 2026-06-10T22:28:37Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
