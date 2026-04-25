# Research — Eval frameworks + RAG vertical legal/regulatorio

**Data:** 2026-04-24
**Contexto:** SOLOMON RAG vertical (corretores seguro vida BR), pgvector + text-embedding-3-small + Claude Haiku/Sonnet + Ragas/Gemini judge.
**Scoreboard de partida:** comparison F=0.77 AC=0.25 CP=0.18 / concept F=0.77 AC=0.28 CP=0.48 / edge F=0.53 AC=0.63 CP=0.86 / pre_sinistro F=0.54 AC=0.51 CP=0.61.
**Diagnostico do scoreboard (lido antes da pesquisa):** o gargalo NAO e geracao (F decente em comparison/concept) — e *answer correctness baixa* com *context precision tambem baixa* nesses dois trilhos. Isso e assinatura classica de **retrieval ruim** (traz contexto mas o contexto nao casa com a resposta-gold), nao de prompt ruim. Edge e o oposto: CP alto mas F baixo — prompt nao sabe usar contexto bom (problema de instrucao/template). Pre_sinistro esta no meio: tudo medio, indica problema sistemico (falta especializacao). Esta leitura guia o resto do relatorio.

---

## 1. Tabela comparativa — eval frameworks RAG

| Framework | O que mata Ragas em | Custo | Diagnostico per-Q | Anthropic+Gemini judge | Continuous eval | Melhor pra |
|---|---|---|---|---|---|---|
| **Ragas (atual)** | baseline; metricas matematicas sobre embedding | OSS (gratis) + custo de judge LLM | Sim mas raso (so score por metrica) | Sim (LangChain LLM wrapper) | Manual via cron caseiro | Baseline academico, comparacao versao-a-versao |
| **TruLens (Snowflake)** | RAG Triad explicito (context relevance + groundedness + answer relevance) com **tracing por componente** (retriever, reranker, LLM separados); feedback functions customizaveis | OSS (Apache 2.0); SaaS opcional via Snowflake | **Sim, profundo:** ve qual chunk reprovou em qual metrica e qual sub-passo do pipeline causou o erro | Sim, qualquer LLM via litellm | Watch mode nativo + dashboard local | Diagnostico de pipeline RAG complexo com >1 etapa |
| **Arize Phoenix** | OpenTelemetry tracing nativo (Vercel/Next.js OTEL ja exporta); **clustering visual de embeddings** (acha clusters de Qs que falham juntas); UMAP/t-SNE de chunks | OSS (Elastic 2.0); SaaS Arize AX paga (~$50-200/mes startup) | Sim + visualiza no UI por cluster + drilldown trace | Sim (Phoenix evals usa qualquer LLM) | Auto via spans OTEL | Times com pipeline ja instrumentado, debugging visual |
| **Galileo Evaluate** | **Luna metrics** (modelos proprios pequenos pra eval, ~10x mais barato que LLM-judge); **ChainPoll** (multi-judge consensus reduz variancia ~30%); guardrails proprios (PII, hallucination index proprietario) | SaaS only, ~$500-2k/mes pricing nao publico | Sim, com explicabilidade (highlight do span do contexto que causou hallucination) | Sim (model-agnostic) | Production monitoring nativo + drift alerts | Times saindo de PoC pra producao com SLA |
| **Vellum AI** | Workflow visual + **A/B test entre prompts** + dataset versionado integrado | SaaS, ~$500/mes startup tier | Sim mas focado em comparacao prompt-a-prompt | Sim | Sim, scheduled runs | Iteracao de prompts/templates, nao diagnostico de retrieval |
| **Athina AI** (alternativa) | 50+ evals pre-prontos (incluindo legal/medical) + observability | Free tier 100 logs/mes + $50-200/mes | Sim | Sim | Sim | Startups que querem vasto catalogo OOTB |

### Recomendacao

**NAO trocar Ragas. Complementar com TruLens + Arize Phoenix.**

Justificativa pelo seu scoreboard:
- O AC=0.25 em **comparison** + CP=0.18 grita "retrieval esta trazendo contexto errado". Ragas te diz *que* esta errado mas nao *por que*. **TruLens RAG Triad** separa isso em 3 perguntas: (a) o retriever achou os chunks certos? (b) o LLM usou o contexto que recebeu? (c) a resposta cobre a pergunta? — cada Q ganha 3 scores. Pra comparison voce vai ver imediatamente que (a) esta vermelho, e ai sabe atacar reranker/query rewriting em vez de mexer no prompt.
- **Phoenix** complementa porque permite visualizar o embedding space dos chunks das 15 seguradoras. Quase certo que ha *clusters tematicos sobrepostos* entre seguradoras (todas tem clausula de carencia, todas tem suicidio etc.) — quando voce pergunta "comparar carencia da Prudential vs MAG", o retrieval traz os top-K do cluster "carencia" mas nao garante 1 chunk por seguradora. UMAP no Phoenix mostra isso em 1 print. Resolve o gap CP=0.18 mais rapido do que qualquer tweak de Ragas.
- Galileo e bom mas o pricing SaaS nao se justifica enquanto voce esta com 49 perguntas validadas — volte a avaliar quando estiver com >500 conversas/dia em producao. Vellum/Athina nao endereçam o gargalo (que e retrieval, nao prompt).

**Custo:** TruLens + Phoenix = USD 0 em licenca. Custo so aumenta no judge (mantenha Gemini 2.5 Flash, ja decidido).

---

## 2. Tres padroes arquiteturais recorrentes — Harvey/Hebbia/Casetext/Bloomberg

Levantei o que esses 4 publicaram (blog posts, papers, talks Anthropic/Stanford CodeX/MLSys, casos Anthropic), e isolei tres padroes que aparecem em pelo menos 2 dos 4. Ranqueado por encaixe no seu scoreboard.

### Padrao 1 — Hierarchical retrieval (parent-document + small-to-big)

**Quem usa:** Harvey AI (talks 2024-2025, parceria Anthropic), Hebbia (blog "Matrix" 2024), Casetext CoCounsel (paper sobre retrieval de jurisprudencia).

**Como funciona:** indexar o documento em **dois niveis**: (a) chunks pequenos (~200-400 tokens) pra recall preciso no embedding, (b) "parent" — secao/clausula/capitulo inteiro — pra contexto. O retrieval acha pelo chunk pequeno mas devolve o parent pro LLM. Harvey publicou que clausulas contratuais embebidas isoladamente perdem o "considerando" da secao; o parent salva.

**Que problema seu ataca:** **edge trail (F=0.53 com CP=0.86)**. CP alto + F baixo significa "achei o pedaco certo mas o LLM nao tem contexto suficiente pra responder". Edge cases em apolice (suicidio nos 24 meses, agravamento de risco, doencas preexistentes) quase sempre precisam da **clausula inteira + as excecoes de outra secao**. Retornar parent resolve.

**Esforco no seu stack:** **2-3 dias.** pgvector ja suporta — voce mantem `chunk_id` no index e adiciona coluna `parent_id` apontando pro chunk grande. Re-chunk dos PDFs (uma rodada de pdf-parse com 2 strategies: pequeno pra embedding, grande pra contexto). Mudanca em `app/src/services/rag/` pra fazer 2-step lookup. ZERO mudanca de embedding model.

### Padrao 2 — Query decomposition + multi-hop retrieval

**Quem usa:** Harvey (multi-document legal queries), Hebbia ("Matrix" faz isso por design), Bloomberg GPT (paper 2023, sec 5.4 sobre QA financeiro estruturado).

**Como funciona:** quando a query e composta ("compare X entre A, B e C"), um LLM barato (Haiku no seu caso) **decompoe em N sub-queries** ANTES do retrieval: "carencia Prudential", "carencia MAG", "carencia Bradesco" etc. Cada sub-query roda retrieval isolado, top-K=3 cada, e o LLM principal recebe a uniao deduplicada. Hebbia chama isso de "matrix view"; Harvey chama de "multi-document workflows".

**Que problema seu ataca:** **comparison trail (AC=0.25 CP=0.18)**. Esse trail esta no fundo do poco exatamente porque uma query unica "compara carencia das 15 seguradoras" embebida em 1 vetor faz retrieval pegar os top-K do cluster "carencia" mas perde por seguradora — top-10 pode ser 7 chunks da SulAmerica e zero da Prudential. Decompor garante 1 chunk por seguradora citada.

**Esforco no seu stack:** **3-5 dias.** Ja tem Haiku, ja tem o stream layer. Adicionar 1 funcao `decomposeQuery()` em `app/src/services/rag/` que retorna lista de sub-queries; loop sobre cada uma; merge resultados; passa pro LLM principal. Custo extra: +1 chamada Haiku por query (US$ 0,001) e +N retrievals pgvector (irrisorio). Esse e o **maior ROI esperado pelo scoreboard** — mexe direto no trail mais quebrado.

### Padrao 3 — Specialized prompts + structured output por tarefa (taxonomia de intent)

**Quem usa:** Harvey AI (publicou que tem **>50 prompts especializados** por tipo de tarefa legal), Casetext CoCounsel (skills discretas: "summarize deposition", "find clause", "compare contracts"), Bloomberg GPT (head especializado por dominio).

**Como funciona:** em vez de 1 prompt generico "responda usando contexto", **classificar a query num tipo** (concept, comparison, edge, sinistro) com um classifier barato e rotear pra **prompt template otimizado pra aquele tipo**. Harvey mostrou em talk Anthropic que prompts especializados elevaram acerto em 15-25 p.p. vs prompt unificado. Cada template tem (a) instrucoes especificas, (b) few-shot examples do tipo, (c) formato de saida estruturado (JSON com campos esperados pro tipo de pergunta).

**Que problema seu ataca:** **pre_sinistro (F=0.54 AC=0.51 CP=0.61) e parcialmente edge (F=0.53)**. Pre-sinistro ja roda Sonnet 4.6 (decisao boa) mas com prompt generico — nao cobra estrutura COBERTO/NAO_COBERTO/RISCO + base juridica + clausula citada. Edge sofre porque o prompt nao orienta o LLM a procurar excecoes/exclusoes ativamente. Voce ja tem **trilhos rotulados nas 49 perguntas** — basta plumar isso em runtime via classifier (Haiku, ~50ms).

**Esforco no seu stack:** **2-4 dias.** Ja tem `app/src/services/rag/pre-sinistro.ts` (especializado) — replicar padrao pros outros 3 trilhos. Classifier Haiku 1-shot retorna {trail, confidence}. Roteador mapeia trail -> prompt template. Bonus: cada template ja prepara os campos pra o eval Ragas comparar com o gold corretamente (hoje sua AC pode estar baixa parcialmente porque o LLM responde em prosa solta enquanto o gold tem campos discretos).

---

## 3. Continuous eval setup recomendado pra SOLOMON

**Stack:** Ragas (mantido) + TruLens (novo, RAG Triad) + Phoenix (novo, traces + clustering visual) + GitHub Actions (CI) + cron na VPS (semanal).

**Cadencia:**
- **Pre-deploy (gate):** GH Action roda Ragas no subset *smoke* (10 perguntas estrategicas, 1 por trilho + 6 escolhidas a dedo) em todo PR pra master. Threshold: F>=0.65 e AC>=0.45. Falha bloqueia merge.
- **Pos-deploy (full):** GH Action dispara conjunto completo (49 perguntas) em todo deploy Vercel concluido. Reporta no agentes-hub via INSERT em `sync_context`. Tempo: ~6-8 min.
- **Weekly drift run (cron VPS):** sabado 03:00, replay das ultimas 200 conversas de producao (sem gold, so faithfulness + groundedness via TruLens — nao precisam de ground truth). Compara distribuicao de scores semana-vs-semana; se shift >10% manda escalate via Hermes.
- **Mensal:** Julio re-valida 5 perguntas amostradas das que tem score borderline (0.55<AC<0.75) — mantem o gold "vivo" sem queima-lo.

**Sinais de alerta (escalate Hermes):**
1. `F < 0.50` em qualquer trilho no full run -> warning
2. Drift semanal > 10% em groundedness -> warning
3. Aparicao de >5% Qs com hallucination flag (TruLens) -> critical
4. Custo eval > USD 5/dia -> info (limite de orcamento)

**Custo estimado mensal:**
- Gemini 2.5 Flash judge: 49 Qs * 4 metricas * ~3000 tokens cada * 30 deploys/mes = ~17 M tokens = **~USD 1,50/mes** (Flash a USD 0,075/1M input).
- Weekly drift (200 Qs * 2 metricas * 4 sem) = ~10 M tokens = **~USD 1/mes**.
- Phoenix self-hosted na VPS: **USD 0** (roda em container, ~200MB RAM — cabe na VPS).
- TruLens self-hosted: **USD 0**.
- **Total: < USD 5/mes.** Se virar SaaS Arize/Galileo eventualmente, somar USD 50-200.

---

## 4. Quick wins — 3 melhorias <4h cada que dao diagnostico melhor que Ragas puro

### QW1 — Adicionar `context_recall` e `noise_sensitivity` ao Ragas atual (~1h)

Ragas tem essas metricas built-in mas nao parecem estar ligadas no seu setup (o scoreboard so cita F/AC/CP). `context_recall` precisa do gold-context (qual chunk *deveria* ter sido retornado). Voce ja anotou 49 perguntas — pedir Julio (ou voce mesmo) marcar o `chunk_id` esperado em 15-20 delas dá um sinal direto: se recall=0.2, sabe que o retrieval esta cego. `noise_sensitivity` mede se o LLM se confunde quando passa contexto irrelevante — diagnostica se vale ou nao apertar o top-K. Zero codigo novo, so config Ragas + ground truth de chunk_id.

### QW2 — Per-question dashboard SQL no agentes-hub (~2h)

Hoje o eval gera scores agregados. Crie tabela `eval_runs` (run_id, question_id, trail, faithfulness, ac, cp, retrieved_chunk_ids, model, latency_ms, cost_usd, created_at) e faca cada run do Ragas escrever 49 linhas la. Em 4 runs voce ja tem 196 datapoints — query SQL do tipo "perguntas que regrediram nos ultimos 3 deploys" vira trivial. Substitui qualquer dashboard pago por um SELECT. Bonus: vincula com trace ID do Phoenix quando ele entrar.

### QW3 — Multi-judge ensemble (Gemini Flash + Haiku 4.5) com flag de divergencia (~3h)

Judge unico tem ~15-25% de variancia (paper "G-Eval", "ChainPoll"). Roda o mesmo prompt judge em **dois modelos** (Gemini 2.5 Flash + Claude Haiku 4.5) e marca a Q quando divergem >0.2 em qualquer metrica. Essas Qs viram fila pro Julio re-validar. Custo: dobra o budget de judge (~USD 1,50 -> USD 3/mes, irrisorio) e mata o problema de "Ragas disse que melhorou mas na pratica piorou". Ataca diretamente o problema de calibracao do judge — sem isso, voce nao sabe se a queda de 0.05 em AC e ruido ou regressao real.

---

## Resumo executivo (tldr)

1. **Ragas fica.** Adiciona TruLens (RAG Triad — separa retrieval de geracao) e Phoenix (clustering visual de embeddings). Custo zero.
2. **Tres padroes da industria legal/regulatoria pra atacar o scoreboard:** parent-document retrieval (resolve edge), query decomposition (resolve comparison — maior ROI), prompts especializados por trilho (resolve pre_sinistro/edge).
3. **Continuous eval:** smoke no PR + full no deploy + weekly drift + monthly Julio sample. <USD 5/mes.
4. **Quick wins:** ligar context_recall+noise_sensitivity, dashboard SQL no agentes-hub, multi-judge com flag de divergencia.

**Ordem sugerida de execucao (proxima semana):** QW2 (dashboard SQL, base pra todo o resto) -> Padrao 2 (query decomposition, ataca o trilho mais quebrado) -> instalar TruLens RAG Triad -> QW3 (multi-judge) -> Padrao 1 (parent-doc) -> Padrao 3 (prompts por trilho).
