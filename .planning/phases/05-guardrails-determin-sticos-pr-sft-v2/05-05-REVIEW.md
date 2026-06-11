---
phase: 05-guardrails-determin-sticos-pr-sft-v2
reviewed: 2026-06-11T03:30:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - app/src/services/rag/claim-guard.ts
  - app/scripts/phase2/claim-guard.test.ts
  - app/src/services/rag/answer.ts
  - app/src/services/rag/stream.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 05: Code Review Report — GRD-04 claim-guard (branch fix/grd04-claim-intent-guard)

**Reviewed:** 2026-06-11
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

O guard GRD-04 acerta os alvos contratuais: G-09/G-10 verbatim disparam, G-11/G-12 e CR-01 fluem ao LLM, a mensagem de orientacao e honesta (nao presume cobertura nem nega), e a paridade answer.ts vs stream.ts esta correta (mesma posicao no pipeline — apos GRD-03, antes do rate fast-path — e mesmo shape de retorno do padrao domain-guard). Suite existente: 13/13 passa (rodada nesta sessao).

Porem, probe empirico adversarial (24 fraseados, rodado nesta sessao via `npx tsx`) revelou **11 mismatches**: o `VERDICT_RE` nao cobre os fraseados de veredicto mais naturais de corretor ("a apolice paga?", "o seguro cobre?", "tem direito a indenizacao?") — exatamente o risco H11 que o guard existe para mitigar — e o gatilho standalone `\bparada\s+cardiaca\b` bloqueia pergunta conceitual pura, mesma classe de regressao do CR-01 original.

Evidencia (probe completo):

```
MISS FN :: meu cliente morreu semana passada, a apólice paga?            -> false
MISS FN :: houve o falecimento do titular, tem direito à indenização?    -> false
MISS FN :: cliente internado com câncer, o seguro cobre o tratamento?    -> false
MISS FN :: O segurado faleceu ontem. O seguro cobre?                     -> false
MISS FN :: O cliente sofreu um acidente de moto, a apólice paga a indenização? -> false
MISS FN :: O titular faleceu em acidente de carro, a familia tem direito ao capital? -> false
MISS FP :: Morte por parada cardíaca é coberta no seguro de vida?        -> true
MISS FP :: Parada cardíaca durante exercício físico é coberta como morte acidental? -> true
MISS FP :: Se o segurado teve um infarto antes da carência, está coberto? -> true
MISS FP :: Se o cliente sofreu um acidente fora do país, tem cobertura?  -> true
MISS    :: O segurado faleceu, posso presumir cobertura?                 -> false (doc do regex promete cobrir)
```

## Critical Issues

### CR-01: VERDICT_RE nao cobre os fraseados de veredicto mais comuns — eventos concretos vazam para o LLM do oraculo (risco H11)

**File:** `app/src/services/rag/claim-guard.ts:29-30`
**Issue:** O lado "veredicto" do AND so reconhece `e/esta/seria/fica cobert*`, `tem cobertura`, `seguradora paga/indeniza/nega/recusa`, `acionar o seguro`, `abrir o sinistro`, `beneficiario recebe/tem direito`, `familia recebe`, `pode presumir`, `veredito`. Ficam de fora os tres fraseados mais naturais de corretor diante de um sinistro concreto:

1. `"a apolice paga?"` / `"a apolice paga a indenizacao?"` — so `seguradora paga` esta no regex;
2. `"o seguro cobre?"` / `"o seguro cobre o tratamento?"` — `cobre` (verbo conjugado) nao esta no regex, apenas o particpio `cobert*`;
3. `"tem direito a indenizacao/ao capital?"` — `tem direito` so casa precedido de `beneficiari[oa]`; sujeitos `titular`, `familia`, `ele/ela`, ou sujeito implicito vazam.

Confirmado empiricamente (probe acima): 6 fraseados realistas de morte/acidente concreto + pedido de veredicto retornam `false` e seguem para o LLM Haiku do oraculo, que NAO passa pelo post-validation do pre-sinistro.ts — o cenario exato que o GRD-04 deveria fechar.

**Fix:** ampliar VERDICT_RE com os sujeitos/verbos faltantes. Como o AND exige evento concreto, adicionar `cobre`/`apolice paga` nao reabre G-11/G-12/CR-01 (verificado: nenhum desses tem evento concreto). Sugestao:

```ts
const VERDICT_RE =
  /(?:\b(?:e|esta|seria|fica)\s+cobert)|(?:\btem\s+cobertura\b)|(?:\b(?:o\s+)?seguro\s+cobre\b)|(?:\bcobre\s+(?:o|a|esse|este|isso)\b)|(?:presumir(?:\s+que\s+(?:e\s+|esta\s+)?|\s+a\s+|\s+)?cobert)|(?:\bpode\s+presumir\b)|(?:\b(?:seguradora|apolice|seguro)\s+(?:paga|indeniza|nega|recusa)\b)|(?:\bacionar\s+o\s+seguro\b)|(?:\babrir\s+o\s+sinistro\b)|(?:\btem\s+direito\s+(?:a|ao)\b)|(?:\bveredito\b)|(?:(?:familia|beneficiari[oa]s?)\s+(?:recebe|tem\s+direito)\b)/
```

Apos a mudanca, re-rodar G-11/G-12/CR-01 e os 4 casos negativos da suite + adicionar os 6 fraseados do probe como casos positivos no `claim-guard.test.ts`.

## Warnings

### WR-01: CLAIM_EVENT_RE nao reconhece evento via substantivo ("falecimento", "obito de") nem participio sem "foi" ("cliente internado")

**File:** `app/src/services/rag/claim-guard.ts:18-19`
**Issue:** O grupo de evento so reconhece formas verbais no preterito (`faleceu`, `morreu`, `sofreu`, `foi internad*`). Fraseados nominais comuns vazam: `"houve o falecimento do titular"`, `"o obito do segurado ocorreu"`, `"cliente internado com cancer"` (sem o auxiliar "foi"). Confirmado no probe: os 3 retornam `false` no lado evento. Combinado com CR-01, sao falsos negativos completos.
**Fix:** adicionar alternativas nominais e participio sem auxiliar:

```ts
|(?:\b(?:houve|apos|com)\s+o\s+(?:falecimento|obito)\b)|(?:\bfalecimento\s+d[oa]\b)|(?:\bobito\s+d[oa]\b)|(?:(?:segurad[oa]|cliente|titular)\s+internad[oa]\b)
```

Validar contra G-11/G-12 (nenhum contem essas formas).

### WR-02: gatilho standalone `\bparada\s+cardiaca\b` bloqueia pergunta conceitual pura — regressao classe CR-01

**File:** `app/src/services/rag/claim-guard.ts:19`
**Issue:** `parada cardiaca` sozinho conta como EVENTO CONCRETO. `"Morte por parada cardíaca é coberta no seguro de vida?"` (conceitual, sem nenhum evento ocorrido) dispara o guard e recebe a mensagem de recusa em vez de ir ao LLM — confirmado no probe. Viola o contrato da fase (perguntas conceituais de cobertura devem fluir, classe G-11/G-12). A alternativa e desnecessaria para o heldout: G-10 ja casa via `faleceu por` (verificado removendo mentalmente a alternativa — `morreu/faleceu por...` cobre).
**Fix:** remover a alternativa `(?:\bparada\s+cardiaca\b)` do CLAIM_EVENT_RE. Re-rodar G-10 verbatim para confirmar que continua disparando (continua: casa em `faleceu por` e em `faleceu\b`). Adicionar `"Morte por parada cardíaca é coberta no seguro de vida?"` como caso negativo na suite.

### WR-03: hipoteticas com verbo no passado ("Se o segurado teve um infarto..., está coberto?") sao bloqueadas — comportamento inconsistente com o caso condicional documentado

**File:** `app/src/services/rag/claim-guard.ts:18-19`
**Issue:** `"se o segurado falecer em acidente, é coberto?"` (futuro do subjuntivo) corretamente flui ao LLM, mas a mesma pergunta com preterito dentro do condicional — `"Se o segurado teve um infarto antes da carência, está coberto?"`, `"Se o cliente sofreu um acidente fora do país, tem cobertura?"` — dispara o guard (confirmado no probe). Em portugues coloquial de corretor, "se + preterito" e fraseado padrao de pergunta hipotetica/conceitual. O bloqueio e na direcao "segura" (recusa orientativa, nao veredicto errado), mas e inconsistente e degrada o produto para perguntas legitimas.
**Fix:** decisao de produto explicita necessaria. Se o bloqueio for inaceitavel, adicionar exempcao por prefixo condicional imediatamente antes do evento, ex.: rejeitar match de evento precedido por `\b(?:se|caso|e\s+se|supondo\s+que)\s+(?:o|a|um|uma|meu|minha)?\s*(?:segurad|client|titular)` via lookbehind ou pre-check. Se for aceitavel (fail-safe), documentar no comentario do regex e adicionar os 2 casos como positivos esperados na suite para travar o comportamento.

### WR-04: regex de "presumir" nao casa o proprio caso documentado "presumir cobertura"

**File:** `app/src/services/rag/claim-guard.ts:24,30`
**Issue:** O comentario (linha 24) afirma cobrir `"presumir cobertura"`, mas `(?:presumir(?:\s+que\s+(?:e\s+|esta\s+)?|\s+a\s+)?cobert)` exige que `cobert` venha colado a `presumir` quando o grupo opcional nao casa — `"presumir cobertura"` (com espaco simples) NAO casa. Confirmado: `"O segurado faleceu, posso presumir cobertura?"` retorna `false` (o `\bpode\s+presumir\b` nao salva porque o fraseado usa "posso"). G-10 passa apenas porque usa "pode presumir".
**Fix:** adicionar a alternativa de espaco simples ao grupo opcional:

```ts
(?:presumir(?:\s+que\s+(?:e\s+|esta\s+)?|\s+a\s+|\s+)?cobert)
```

E considerar `\bposso\s+presumir\b` ao lado de `\bpode\s+presumir\b`.

## Info

### IN-01: alternativas mortas/redundantes em CLAIM_EVENT_RE

**File:** `app/src/services/rag/claim-guard.ts:18-19`
**Issue:** A alternativa final `(?:faleceu\b(?!\s+na\s+proposta))` subsume `(?:faleceu\s+ontem\b)` e todo o ramo `sujeito + faleceu` do primeiro grupo — essas alternativas nunca sao a unica via de match. Codigo morto em regex desse tamanho dificulta manutencao e mascara a real superficie de disparo (ex.: WR-02 passou despercebido por isso).
**Fix:** remover `faleceu\s+ontem` e simplificar o ramo de sujeito para os verbos que NAO tem alternativa standalone (`morreu`, `veio a obito`, `se acidentou`, `teve um acidente`). Quebrar o regex em sub-padroes nomeados compostos via `new RegExp([...].join('|'))` para legibilidade.

### IN-02: ausencia de `\b` inicial em `ele|ela` e match da conjuncao "e" antes de "cobertura"

**File:** `app/src/services/rag/claim-guard.ts:19,30`
**Issue:** (a) `(?:segurad[oa]s?|clientes?|...|ele|ela)` sem `\b` inicial permite match por substring: "aqu**ele faleceu**", "parc**ela foi internada**". Impacto pratico baixo (semantica geralmente equivalente), mas e impreciso. (b) `\be\s+cobert` casa a conjuncao "e" em frases como "diferenca entre exclusao **e cobertura**" — combinada com um evento na mesma frase, vira FP. 
**Fix:** prefixar o grupo de sujeito com `\b`; avaliar exigir contexto de pergunta para `e cobert` (ex.: `\be\s+cobert[oa]` em vez de prefixo de "cobertura").

### IN-03: stripAccentsLower duplicado em 5 modulos de services/rag

**File:** `app/src/services/rag/claim-guard.ts:6` (tambem `answer.ts:898`, `domain-guard.ts:6`, `pre-sinistro.ts:463`, `query-decomposer.ts:61`)
**Issue:** Quinta copia da mesma funcao no diretorio. Cada copia e um ponto onde o bug de mojibake (que motivou o WR-05 citado no comentario) pode reaparecer com implementacao divergente.
**Fix:** extrair para `app/src/services/rag/text-normalize.ts` (ou `@/lib`) e importar nos 5 modulos. Fora do escopo deste PR; candidato a follow-up.

---

**Paridade answer.ts vs stream.ts (verificada, sem findings):** GRD-04 posicionado identicamente nos dois paths (apos GRD-03 domain-guard, antes do rate fast-path — `answer.ts:193-201`, `stream.ts:98-108`); mesmo `model: 'claim-verdict-guard'`, mesmo shape de retorno do precedente domain-guard (`confidenceScore: 1.0`, `lowConfidence: false`, `citationCoverage: 1`, `sources/citations` vazios); `saveConversation` chamado igualmente nos dois. 

**claimGuidanceMessage (verificada, sem findings):** nao presume cobertura, nao afirma nao-cobertura, direciona ao trilho Pre-Sinistro pedindo apolice + descricao do evento. Acentuacao ausente (ASCII puro) e consistente com as demais mensagens de guard do repo.

**Backtracking:** nenhum quantificador aninhado nos dois regexes; sem risco de backtracking catastrofico.

_Reviewed: 2026-06-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
