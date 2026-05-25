# SOLOMON — Parecer de Prontidão para Lançamento

**Tipo:** auditoria read-only (issue #56)
**Data:** 2026-05-25 15:38 UTC
**Auditor:** Claude (Opus) — sessão notebook
**Escopo:** banco de produto `ohmoyfbtfuznhlpjcbbk` + agentes-hub `zwnlpumonvkrghoxnddd` + repo `SOLOMON-` @ `master` (df65e4a) + prod Vercel `app-atalaia.vercel.app`
**Garantia:** somente `SELECT`, leitura de repo, `git` read-only e probes HTTP sem custo. **Zero** migration, ingestão, embedder, promotion, canary ou DELETE. Nenhum dado de produto foi tocado.

> Todos os números abaixo vêm de queries reais executadas nesta sessão, não de memória ou STATUS.md. Onde a documentação do projeto diverge da realidade do banco/código, isso está marcado como **DRIFT**.

---

## 0. Veredicto executivo

| Pergunta | Resposta | Confiança |
|---|---|---|
| 1. Pronto para **lançar** (venda ampla, multi-seguradora, multi-trilho)? | **NÃO** | alta |
| 2. Pronto para **piloto controlado** (Julio + 1-3 corretores, escopo restrito)? | **SIM, condicional** | alta |
| 3. Pronto para **venda ampla**? | **NÃO** | alta |

**Tese em uma linha:** SOLOMON tem **um produto vendável hoje** — cotação determinística de vida (taxas/prêmios) para **MAG e Prudential** — embrulhado num produto **ainda imaturo** (oráculo conceitual de retrieval fraco, pre-sinistro nunca exercitado em prod e rodando em modelo diferente do documentado, dashboard sem autenticação). O piloto deve vender **só o trilho forte**; o resto é demo, não garantia.

---

## 1. O que está REALMENTE no read path de produção

Esta é a distinção mais importante do parecer. **O que existe no banco ≠ o que é servido ao corretor.**

- **Corpus servido:** `corpus_routing` tem 1 linha — `Prudential = legacy`. O read path usa **sempre** `match_documents` (legacy). Confirmado em 3 camadas independentes:
  - **DB routing:** `corpus_routing.mode = 'legacy'`.
  - **Código:** `chooseRetrievalCorpus()` retorna `match_documents` enquanto `SHADOW_CORPUS_ALLOWLIST` estiver vazia (comentário no `search.ts:42` e `:116`: *"without it, every query stays on legacy"*). Nenhum caller passa `insurerNames` para forçar shadow.
  - **Telemetria real (`retrieval_traces`, 321 linhas):** `legacy/serve` = **284 chamadas** (última 2026-05-25, avg 1102ms, ~29 chunks); `shadow/preview-only` = **37 chamadas** (parou 2026-05-21, resultado **descartado**, nunca servido).
- **Filtro do RPC legacy (`match_documents`):** serve só `embedding IS NOT NULL` **AND** `valid_until IS NULL` **AND** exclui não-vida (`tipo_produto IN (PGBL, VGBL, previdencia, capitalizacao, residencial, viagem, auto)`).
- **DRIFT de dado — filtro não-vida está inerte:** `tipo_produto` é **NULL em ~99% dos chunks** (crawler não popula). Logo a guarda anti-não-vida quase nunca dispara: chunks de auto/RE (ex.: Santander Auto/RE) **passam** no read path como se fossem vida. Volume é pequeno mas é um vetor de resposta errada.

---

## 2. Inventário por seguradora (números reais)

`insurers` = 13 ativas. `documents` = 24.694 chunks. `products` = 2.157. `insurer_rate_tables` = 271.978 linhas.

| Seguradora | Fonte | Chunks **servíveis** (vida, legacy) | conditions_pdf | rate_table_pdf | Products catalog | Rate table (linhas) | Chunks sem embedding | product_id NULL |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| **MAG Seguros** | crawler | **6.378** | 404 | 5.974 | 0 | **265.880** | 0 | 6.378 |
| **Prudential do Brasil** | opin | **5.614** | 5.184 | 2.418 | 12 | **6.098** | 29 | 6.108 |
| Zurich | crawler | 3.786 | 3.793 | 0 | 44 | 0 | 0 | 3.787 |
| Bradesco | crawler | 1.869 | 1.893 | 0 | 590 | 0 | 0 | 1.812 |
| Azos | crawler | 1.385 | 1.385 | 0 | 0 | 0 | 0 | 1.385 |
| Tokio Marine | opin | 930 | 930 | 0 | 6 | 0 | 0 | 925 |
| MetLife | crawler | 885 | 885 | 0 | 0 | 0 | 0 | 885 |
| SulAmerica | crawler | 563 | 563 | 0 | 15 | 0 | 0 | 553 |
| Porto Seguro | opin | 482 | 483 | 0 | 1 | 0 | 0 | 482 |
| MAPFRE | opin | 449 | 449 | 0 | 60 | 0 | 0 | 449 |
| Icatu | opin | 137 | 137 | 0 | **1.396** | 0 | 0 | **0** |
| Santander Auto/RE | crawler | 124 | 126 | 0 | 31 | 0 | 0 | 116 |
| Caixa Vida e Prev. | opin | 1 | 1 | 0 | 2 | 0 | 0 | 0 |

### 2.1 Leitura da tabela

- **product_id NULL é a regra, não a exceção:** 22.602 dos 24.694 chunks não têm `product_id`. Só **Icatu (137) e Caixa (1)** têm 100% dos chunks resolvidos a um produto. Para todo o resto, o chunk não sabe a que produto pertence — a atribuição de produto na resposta depende do header do chunk + LLM, não de FK. Isso é tolerável para oráculo, mas limita filtragem por produto.
- **Catálogo (`products`) vs condições indexadas são coisas diferentes:** Icatu tem **1.396 produtos catalogados** mas só **137 chunks** de texto — catálogo rico, condições magras. Bradesco tem 590 produtos. **Só 94 de 2.157 produtos (4,4%) têm `terms_url`** (link para PDF público). Catálogo grande não significa condições lidas.
- **Caixa é um placeholder:** 1 chunk. Não é utilizável.

---

## 3. As 4 distinções que a issue pediu (PDF / chunk / tabela)

| Conceito | Estado real |
|---|---|
| **PDF enviado no chat** | **Não existe esse caminho.** Nem dashboard nem WhatsApp indexam PDF enviado pelo usuário. Pre-sinistro recebe **texto colado** da apólice, não PDF. Qualquer expectativa de "manda o PDF e ele lê" é falsa hoje. |
| **PDF no repo** | **0 PDFs versionados** (`git ls-files '*.pdf'` = 0). Os PDFs vivem em URLs públicas das seguradoras / OPIN, não no git. |
| **PDF com URL pública** | **158 URLs distintas** de PDF efetivamente indexadas (`source_url` não-nulo). 2.597 chunks vêm de **OPIN API sem URL** (Icatu etc.) — não há PDF público por trás, é dado estruturado da API. |
| **PDF realmente indexado no banco** | 24.694 chunks com embedding (menos 29 da Prudential sem embedding). Split: **conditions_pdf = 16.233**, **rate_table_pdf = 8.392**. |
| **chunk legacy** | `valid_until IS NULL`. É **o que o read path serve hoje**. |
| **chunk shadow** | `valid_until = 1970-01-01` + `metadata.shadow=true` + `hash_scheme=url-aware-v1`. Total Prudential: **1.982 versionados**, dos quais **1.953 servíveis** se flipado (os 29 restantes = exatamente os sem embedding). **100% dark hoje** — só preview, nunca servido. |
| **rate table** (estruturada) | `insurer_rate_tables`: **MAG 265.880** linhas (23 produtos, idade 16-70) + **Prudential 6.098** (19 produtos, idade 14-75). Mais ninguém. É o trilho determinístico (zero alucinação). |
| **products catalog** | 2.157 produtos, todos `active=true`, 94 com `terms_url`. Metadado, não texto de condição. |
| **conditions_pdf** | 16.233 chunks de condições gerais. Esta é a matéria-prima do oráculo conceitual. |

---

## 4. Estado do shadow-v4 (Fase 2 Prudential)

- **1.953 chunks shadow** prontos e servíveis-se-flipados (limpos, com product_id resolvido em 1.483 e quarentenados em 499 com product_id NULL).
- **Routing = legacy.** Flip exige (AND-gate, por design): `corpus_routing.mode='shadow'` **E** `SHADOW_CORPUS_ALLOWLIST` não-vazia. Ambos no estado seguro.
- **Conclusão:** todo o investimento da Fase 2 (PRs #3B.x / #3C.x) está **construído, validado em preview, e parqueado**. Não há regressão em prod porque está isolado — mas também não há ganho em prod. **Decisão pendente do CEO:** promover (com canary + eval comparativo) ou manter dark. Esta auditoria **não** promove nada.
- **Legacy ativo:** os ~5.620 chunks legacy da Prudential (5.609 sem product_id + 11 resolvidos) continuam sendo a fonte servida — mais sujos que o shadow, mas é o que o corretor vê.

---

## 5. Trilhos — prontidão individual

### Trilho 1 — Cotação determinística (`rate-lookup.ts`) — ✅ PRONTO
- Fast-path zero-LLM: detecta intenção de prêmio/taxa, consulta `insurer_rate_tables`, formata com citação de página. Cobre **MAG + Prudential apenas**.
- Eval (run 2026-05-14): `rate_mag` F=0.99 / CP=1.00 / CR=1.00; `rate_prudential` F=1.00 / CP=1.00 / CR=1.00. **Retrieval perfeito.** O AC baixo (0.50-0.55) é artefato conhecido do judge (penaliza formato/metadata extra), não erro de valor — ver memória `feedback_ac_paradoxo_judge`.
- **Este é o produto vendável.**

### Trilho 2 — Oráculo conceitual (`answer.ts` + `compare.ts`) — 🟡 FRACO
- Retrieval cego em queries conceituais/comparativas. Eval mais recente (2026-05-14): `concept` F=0.69 / CP=0.41 / CR=0.33; `comparison` F=0.74 / CP=0.13 / CR=0.24. **CP/CR baixíssimos em comparison** = recupera o chunk errado e perde o certo.
- Pipeline é sofisticado (jargão, Padrão A/B/C round-robin, Cohere rerank, diversify) mas o gargalo é retrieval, confirmado pela própria Fase 2.
- **Serve para responder "o que diz a condição da seguradora X" single-insurer; não confiável para comparativo multi-seguradora.**

### Trilho 3 — Pre-sinistro (`pre-sinistro.ts`) — 🔴 NÃO EXERCITADO + DRIFT
- **`claim_analyses` = 0 linhas.** Nunca rodou em produção. Veredicto COBERTO/NÃO_COBERTO/RISCO nunca foi emitido a um usuário real.
- **DRIFT crítico de modelo:** CLAUDE.md e STATUS.md afirmam **Claude Sonnet 4.6** (alta consequência jurídica). O código usa `PRE_SINISTRO_MODEL ?? "gemini-2.5-flash"` (Wave A.2). **Está rodando em Gemini Flash, não Sonnet.** O `compare.ts` idem (`COMPARE_MODEL ?? "gemini-2.5-flash"`).
- **Bloqueador de venda:** emitir veredicto de cobertura de sinistro em Gemini Flash, sem nenhum teste em prod, é risco jurídico real para o corretor. Não vender este trilho no piloto.

---

## 6. Superfícies de entrega

### WhatsApp — ✅ funcional
- Webhook `app/src/app/api/webhook/whatsapp/route.ts`: GET verify + POST com dedup via `idempotency_keys` (claim por messageId, fail-open em erro de DB), handler + `sendMessage`. Provider default `kapso`.
- Histórico real: **69 conversas**, todas canal `whatsapp`, modelos `claude-sonnet-4` / `gpt-4o-mini` / `claude-haiku-4.5`. **Última: 2026-05-12.** Sem tráfego há 13 dias.
- Probe prod: `GET /api/webhook/whatsapp` com token errado → **403** (endpoint vivo, validando token). ✅

### Dashboard — 🟡 funcional SEM autenticação
- `app/src/app/(app)/layout.tsx` só envolve `AppShell` — **nenhum guard de auth**. Login/signup são mockup (confirmado em memória `project_dashboard_auth_mockup`). Rotas `(app)` abertas a quem tiver a URL.
- Probe prod: landing `GET /` → **200**. ✅ App no ar.
- **0 conversas com canal `dashboard`** salvas — o chat do dashboard (stream) não persiste em `conversations`. Observabilidade do uso do dashboard é cega.
- **Bloqueador para venda ampla:** sem auth, não há isolamento por corretor, billing, nem LGPD defensável. OK para piloto onde só o CEO/Julio têm a URL.

### Compare (`/api/compare`) — 🟡 mesmo gargalo do trilho 2 + Gemini Flash.

---

## 7. Providers LLM (`llm.ts`) — estado real vs documentado

- **Cadeia chat:** Anthropic Haiku 4.5 → Gemini 2.5 Flash → OpenAI GPT-4o-mini. Timeouts: Anthropic 15s, Gemini 20s, OpenAI 30s (fix `b4e4542` em master).
- **DRIFT:** CLAUDE.md diz "Haiku 4.5 via OpenRouter". OpenRouter foi **removido** da cadeia (conta esgotada). E por session_summary, **Anthropic está sem crédito** → na prática o **primário Haiku falha e prod serve Gemini 2.5 Flash**. O "default Haiku" é nominal; o modelo real de produção é Gemini Flash.
- **Risco de concentração:** com Anthropic morto e OpenRouter fora, a chain real é Gemini→OpenAI. Se a chave Gemini cair (já aconteceu — `CONSUMER_SUSPENDED`, ver `project_llm_chain_state`), só resta OpenAI. Frágil para produção comercial.

---

## 8. Git / Vercel / VPS — drift e o fix `ed5cced`

- **`ed5cced` ("fix: subir timeouts de fallback LLM") NÃO está no master.** Está **apenas** na branch `fix/llm-api-error-handling`.
- **PORÉM o conteúdo do fix ENTROU no master** via cherry-pick **`b4e4542`** (confirmado ancestral de `master`; `git branch --contains b4e4542` = `master`). Ou seja: o **SHA** `ed5cced` não entrou, mas o **fix** sim. Prod tem os timeouts corrigidos.
- **Drift notebook ↔ GitHub:** `master` local = `origin/master` = `df65e4a`, **0 ahead / 0 behind**. Sincronizado.
- **PRs abertas:** apenas **#55** (Instagram Reel — criativo, não-produto) + **#56** (esta issue). **Nenhuma PR de produto pendente.** Os PRs de Fase 2 (#47-#54) já foram merged.
- **Vercel:** prod no ar (200 na landing, 403 no webhook verify). Não há indício de drift Vercel↔master. Não foi possível re-verificar build interno da Vercel nesta sessão (CLI não instalada); evidência é o comportamento HTTP vivo.
- **VPS:** não auditada ao vivo nesta sessão (sem SSH). O checkout canônico é `/root/solomon/repo/`; STATUS de sync por `sync_context` mostra última sessão notebook 2026-05-25.

---

## 9. Documentação vs realidade (lista de DRIFT)

| Documento diz | Realidade |
|---|---|
| Pre-sinistro = Claude Sonnet 4.6 | Código = `gemini-2.5-flash` (env `PRE_SINISTRO_MODEL`) |
| Chat = Haiku 4.5 via OpenRouter | OpenRouter removido; Anthropic sem crédito; **prod serve Gemini 2.5 Flash** |
| Filtro exclui não-vida | `tipo_produto` quase todo NULL → filtro inerte; auto/RE vaza |
| STATUS.md "pronto pro Julio" baseline 2026-04-25 | Scoreboard é de antes da Fase 2; pre-sinistro listado como Sonnet (errado) |
| (implícito) shadow é o corpus melhor | Shadow existe mas está dark; legacy sujo é o servido |

---

## 10. Resposta direta às 10 perguntas

1. **Pronto para lançar?** Não. Auth ausente, 2 dos 3 trilhos imaturos, modelo de produção diverge do documentado.
2. **Pronto para piloto controlado?** Sim, **se** restrito a: trilho de cotação (MAG/Prudential) + oráculo single-insurer, usuários conhecidos (Julio + poucos), sem vender pre-sinistro.
3. **Pronto para venda ampla?** Não. Falta auth, billing, isolamento por corretor, retrieval comparativo confiável, pre-sinistro validado, redundância de LLM.
4. **Seguradoras realmente utilizáveis?** **Forte:** MAG e Prudential (cotação + condições). **Razoável (só oráculo de condições):** Zurich, Bradesco, Azos, Tokio, MetLife, SulAmérica, Porto, MAPFRE. **Fraca:** Icatu (catálogo sem texto), Santander Auto/RE (não-vida). **Inútil:** Caixa (1 chunk).
5. **Quais têm condições gerais indexadas?** Todas exceto Caixa (1 chunk) e Icatu (137 chunks, fino). Volume real: Prudential 5.184, Zurich 3.793, Bradesco 1.893, Azos 1.385, MAG 404 (MAG é majoritariamente rate table).
6. **Quais têm products catalog?** Icatu (1.396), Bradesco (590), MAPFRE (60), Zurich (44), Santander (31), SulAmérica (15), Prudential (12), Tokio (6), Caixa (2), Porto (1). MAG, MetLife, Azos = 0.
7. **Quais têm rate tables?** Só **MAG (265.880) e Prudential (6.098)**. Mais ninguém.
8. **O que falta para MVP comercial seguro?** (a) Auth real no dashboard; (b) alinhar pre-sinistro ao modelo correto e validá-lo (≥0 análises em prod hoje); (c) redundância de LLM (sair da dependência Gemini); (d) decidir shadow vs legacy para Prudential; (e) corrigir filtro não-vida (popular `tipo_produto`); (f) eval fresco pós-Fase-2.
9. **Bloqueadores reais?** (i) Pre-sinistro em Gemini Flash sem teste (risco jurídico); (ii) dashboard sem auth (LGPD/billing); (iii) cadeia LLM frágil (Anthropic morto, Gemini já caiu uma vez); (iv) retrieval comparativo cego (CP/CR ~0.15-0.24).
10. **O que pode ficar para depois?** Promoção do shadow-v4; expansão além de MAG/Prudential no determinístico; melhoria de CR/CP do comparativo; persistência do canal dashboard em `conversations`; backfill dos 29 embeddings Prudential.

---

## 11. Recomendação de sequência (não-executada — só parecer)

**Para liberar o piloto controlado (rápido):**
1. Decidir o modelo do pre-sinistro e **desligar a venda desse trilho** até validar (ou subir 1 análise real e revisar).
2. Comunicar a Julio que cotação (MAG/Prudential) é o trilho garantido; oráculo é "consulta de condição", não comparador.

**Antes de venda ampla (ordem de bloqueio):**
1. Auth real no dashboard.
2. Redundância de LLM (recarregar Anthropic ou OpenRouter; não depender de uma chave Gemini).
3. Pre-sinistro: modelo correto + bateria de teste com casos reais.
4. Eval Ragas fresco sobre o master atual (o último é 2026-05-14, pré-reskin e pré-decisões de routing).
5. Corrigir `tipo_produto` para a guarda não-vida voltar a funcionar.

---

*Fim do parecer. Documento gerado por auditoria read-only — nenhuma alteração foi feita em produto, banco, embeddings, routing ou deploy.*
