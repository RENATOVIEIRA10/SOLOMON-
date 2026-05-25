# SOLOMON — Plano de Fechamento de Gaps para Lançamento

**Tipo:** plano operacional read-only (issue #58)
**Data:** 2026-05-25 16:08 UTC
**Base:** parecer PR #57 (`docs/audit-runs/launch-readiness-20260525T153840Z/SOLOMON_LAUNCH_READINESS.md`, mergeado em `d02a87d`)
**Natureza:** este documento **planeja**. Não implementa código, não muda produto, não promove corpus, não roda canary, não faz flip, não deleta, não muta `documents`, não dispara ingestão, não coloca pré-sinistro em prod, não autoriza promessa comercial ampla.

> Cada frente abaixo transforma uma **promessa perigosa** (bloqueada pelo parecer #57) numa **frente operacional** com caminho de saída. A regra-mestra: nenhuma promessa volta a ser comercial até a frente atingir seu **critério de pronto**. Até lá, vale só a **promessa segura intermediária**.

---

## Guardrails permanentes (válidos para TODAS as frentes e PRs)

Estes guardrails herdam do parecer #57 e valem até revogação explícita do CEO:

1. **read-only por padrão** — PRs de diagnóstico/harness/offline-eval primeiro; mutação de produção só com aprovação dedicada por PR.
2. **sem promotion** do shadow-v4 (routing permanece `legacy`).
3. **sem canary** automático.
4. **sem full flip** de corpus.
5. **sem DELETE** em nenhuma tabela de produto.
6. **sem mutation em `documents`** (nem `valid_until`, nem `metadata`, nem embeddings) fora de PR aprovado.
7. **sem ingestão automática** — qualquer ingestão é manual, isolada, com dry-run.
8. **sem pré-sinistro em produção** até a Frente 2 fechar.
9. **sem promessa comercial ampla** — só o escopo seguro do piloto (cotação MAG+Prudential, consulta assistida controlada).

**Ordem global recomendada:** Frente 5 (hardening do que já vende) → Frente 4 (garantia de resposta) → Frente 1 (comparador) → Frente 3 (PDF on-demand) → Frente 2 (pré-sinistro). Justificativa: proteger e estabilizar o trilho que **já vende** antes de expandir promessa; pré-sinistro é o de maior consequência jurídica e fica por último.

---

## Frente 1 — "Compara qualquer seguradora"

### Problema atual
Retrieval comparativo é o ponto mais fraco do produto. Eval (run 2026-05-14): `comparison` CP=0.13 / CR=0.24, `concept` CP=0.41 / CR=0.33. O pipeline `answer.ts` tem Padrão A/B/C (round-robin cross-insurer, `roundRobinGlobalSearch`) e Cohere rerank, mas o corpus legacy servido é sujo (Prudential: 5.609 chunks sem `product_id`). O corpus shadow-v4 limpo (1.953 chunks) existe mas está **dark** (`corpus_routing=legacy`). Comparar hoje mistura/perde chunks → atribuição errada de cláusula entre seguradoras é risco real.

### Meta
Comparador confiável **dentro de um conjunto fechado e medido** de seguradoras (começando por MAG+Prudential, expandindo por evidência), com CR/CP medidos por par de seguradoras antes de qualquer promessa.

### Entregas necessárias
- Harness de **eval comparativo offline** que roda shadow vs legacy lado a lado sobre as 49 perguntas Ragas (e o subconjunto `comparison`/`concept`), **sem flip** — usa o preview já existente (`match_shadow_documents`) em modo leitura.
- Relatório por par de seguradoras: CR/CP/F do comparativo legacy vs shadow.
- Decisão documentada shadow-vs-legacy para Prudential (continua a Frente "3C preview").
- Query decomposition para comparativos (quebrar "compare X vs Y" em N buscas single-insurer fundidas) — só design + protótipo offline.
- Whitelist de pares comparáveis (seguradoras com corpus servível ≥ limiar medido).

### Critério de pronto
- CR ≥ 0,60 e CP ≥ 0,55 no trilho `comparison` para os pares na whitelist, medido em eval fresco.
- Zero atribuição cruzada de cláusula em revisão manual de 10 comparativos pelo Julio.
- Decisão shadow/legacy tomada e registrada (com canary controlado **se** aprovado em PR separado).

### Promessa segura intermediária
> "SOLOMON consulta as condições de **uma seguradora por vez** com citação; comparação lado a lado disponível **apenas para MAG e Prudential** no piloto."

### Riscos se pular
Corretor recebe comparação que funde cláusulas de seguradoras diferentes → recomenda errado ao cliente final → erro de venda/sinistro atribuível ao SOLOMON. É o risco de reputação mais provável a curto prazo.

### Sequência de PRs
1. **PR 1.1** (read-only) — harness de eval comparativo offline shadow-vs-legacy + relatório por par. Sem flip.
2. **PR 1.2** (read-only) — query decomposition para comparativos: protótipo + eval offline.
3. **PR 1.3** (design) — decisão shadow/legacy Prudential + whitelist de pares + plano de canary (não executa).
4. **PR 1.4** (mutação, só se 1.3 aprovado) — canary controlado de 1 seguradora, gated, reversível. Fora do escopo deste plano até #57-guardrails serem relaxados.

---

## Frente 2 — "Resolve pré-sinistro"

### Problema atual
`claim_analyses = 0` — o trilho **nunca rodou em produção**. **DRIFT crítico:** `pre-sinistro.ts` usa `PRE_SINISTRO_MODEL ?? "gemini-2.5-flash"`, enquanto CLAUDE.md/STATUS.md afirmam Claude Sonnet 4.6 (decisão de alta consequência jurídica). Emitir veredicto COBERTO/NÃO_COBERTO/RISCO em Gemini Flash, sem teste, é risco jurídico inaceitável.

### Meta
Pré-sinistro validado **offline** num golden set revisado por humano, no modelo correto, com taxa de erro conhecida — antes de qualquer exposição a usuário.

### Entregas necessárias
- Golden set de casos de pré-sinistro (evento + apólice + veredicto esperado) revisado por Julio.
- Harness de eval offline do pré-sinistro com métrica de acerto de veredicto + qualidade do checklist.
- Decisão e fixação explícita do modelo (Sonnet 4.6 vs alternativa), com `PRE_SINISTRO_MODEL` documentado e alinhado em CLAUDE.md/STATUS.md.
- Política de abstenção: quando o modelo deve dizer "não tenho base para opinar" em vez de arriscar veredicto.
- Disclaimer jurídico obrigatório na saída (não substitui análise da seguradora).

### Critério de pronto
- Acerto de veredicto ≥ limiar acordado com Julio (sugerido ≥ 0,90 em COBERTO/NÃO_COBERTO; RISCO sempre aceitável como abstenção segura) no golden set.
- Zero falso-COBERTO em casos claramente excluídos (falso positivo de cobertura é o erro proibido).
- Modelo correto fixado e documentação corrigida.

### Promessa segura intermediária
> "Pré-sinistro **não faz parte do piloto.** Em desenvolvimento e validação interna."

### Riscos se pular
Veredicto errado de cobertura → corretor orienta cliente a abrir (ou não) sinistro com base em alucinação → dano financeiro/jurídico ao segurado e ao corretor → responsabilidade imputável ao SOLOMON. É o maior risco de consequência do produto.

### Sequência de PRs
1. **PR 2.1** (read-only) — golden set de pré-sinistro (fixtures) + doc de critérios com Julio.
2. **PR 2.2** (read-only) — harness de eval offline + métrica de veredicto/checklist; roda contra golden set, **nunca contra prod**.
3. **PR 2.3** (doc) — decisão de modelo + correção de DRIFT em CLAUDE.md/STATUS.md + política de abstenção e disclaimer.
4. **PR 2.4** (futuro, fora deste plano) — exposição controlada só após critério de pronto + aprovação explícita do CEO.

---

## Frente 3 — "Lê qualquer PDF"

### Problema atual
**Não existe caminho de PDF enviado pelo usuário.** Nem dashboard nem WhatsApp indexam PDF do corretor. Pré-sinistro recebe texto colado. O corpus é só crawl/OPIN: 158 URLs públicas indexadas, 0 PDFs versionados no repo, 2.597 chunks OPIN sem URL. A promessa "manda o PDF que ele lê" é falsa hoje.

### Meta
Ingestão **on-demand, manual e isolada** de um PDF específico (ex.: condição geral nova de uma seguradora do escopo), com dry-run e sem tocar o corpus de produção automaticamente.

### Entregas necessárias
- Design de pipeline de ingestão on-demand reaproveitando `crawl-pdfs-playwright.ts` / chunker / embedder existentes, mas **gated por confirmação manual** e isolado (staging/shadow, nunca auto-merge no read path).
- Limites explícitos: tipo de PDF aceito (condição geral de vida das seguradoras do escopo), tamanho, idioma.
- Dry-run obrigatório (mostra chunks/embeddings que seriam criados sem gravar).
- Telemetria de proveniência (de onde veio o PDF, quem aprovou).

### Critério de pronto
- Ingerir 1 PDF novo de teste em staging, validar chunks/embeddings, sem afetar o read path de produção.
- Caminho reversível e auditável (sabe-se exatamente o que entrou e como remover — sem usar DELETE em prod).

### Promessa segura intermediária
> "SOLOMON responde sobre as condições **já indexadas** de MAG e Prudential. Upload de PDF pelo corretor **não está disponível** no piloto."

### Riscos se pular
Expectativa de "lê qualquer PDF" gera frustração imediata na primeira interação (o corretor manda um PDF e nada acontece). Além disso, ingestão automática sem gate poluiria o corpus com PDFs fora de escopo (não-vida, outra seguradora) → degrada o retrieval que já é frágil.

### Sequência de PRs
1. **PR 3.1** (read-only/design) — especificação do pipeline on-demand + limites + contrato de proveniência.
2. **PR 3.2** (read-only) — dry-run runner que simula ingestão de 1 PDF e reporta chunks/embeddings previstos, sem gravar.
3. **PR 3.3** (mutação isolada, gated) — ingestão real em staging/shadow de 1 PDF, manual, reversível. Não entra no read path.

---

## Frente 4 — "Responde tudo com garantia"

### Problema atual
Garantia só existe no trilho determinístico (rate-lookup MAG/Prudential, F~1.0). O oráculo conceitual é fraco (concept F=0.69, comparison F=0.74) e o **filtro não-vida está inerte** (`tipo_produto` NULL em ~99% → chunks de auto/RE podem vazar para respostas de vida). `answer.ts` já calcula `confidenceScore`/`lowConfidence` (threshold 0,55) e tem `buildFallbackAnswer`, mas a promessa "responde tudo com garantia" extrapola o que o pipeline garante.

### Meta
Resposta com **abstenção honesta**: o SOLOMON diz claramente quando não tem base, em vez de arriscar. Garantia forte só onde há lastro (rate-lookup); aviso explícito de baixa confiança no resto.

### Entregas necessárias
- Auditoria/calibração do `confidenceScore` e do `LOW_CONFIDENCE_THRESHOLD` contra a eval (quando lowConfidence acerta vs erra).
- Mensagem de abstenção padronizada quando confiança < limiar (o passo 4 do system prompt já manda abster; reforçar no consumer).
- Plano para popular `tipo_produto` e reativar a guarda não-vida (read-only: medir quantos chunks seriam reclassificados antes de mutar).
- Eval Ragas **fresco** sobre o `master` atual (último é 2026-05-14, pré-reskin e pré-decisões de routing).
- Persistência do canal `dashboard` em `conversations` (hoje 0 linhas dashboard) para observar uso real.

### Critério de pronto
- Em revisão manual, toda resposta de baixa confiança exibe aviso e nenhuma resposta de alta confiança contém atribuição errada.
- Guarda não-vida reativada (ou plano aprovado) com medição de impacto.
- Eval fresco publicado em `eval_runs` como nova baseline.

### Promessa segura intermediária
> "SOLOMON dá **cotação garantida** para MAG e Prudential e **consulta assistida com citação** para condições de vida; quando não tem base, ele avisa em vez de inventar."

### Riscos se pular
"Responde tudo com garantia" + retrieval cego = resposta confiante e errada (pior combinação para um corretor, que repassa ao cliente). Vazamento de chunk auto/RE numa resposta de vida fragiliza a credibilidade.

### Sequência de PRs
1. **PR 4.1** (read-only) — eval Ragas fresco sobre master + nova baseline em `eval_runs`.
2. **PR 4.2** (read-only) — auditoria de calibração do confidence + medição de quantos chunks têm `tipo_produto` populável (sem mutar).
3. **PR 4.3** (código, baixo risco) — reforço da abstenção no consumer + persistência do canal dashboard em `conversations`.
4. **PR 4.4** (mutação gated, futuro) — backfill de `tipo_produto` para reativar guarda não-vida, com dry-run e aprovação.

---

## Frente 5 — "Está pronto para venda ampla"

### Problema atual
Bloqueadores estruturais: **dashboard sem auth** (`(app)/layout.tsx` só envolve `AppShell`, login/signup são mockup, rotas abertas); **cadeia LLM frágil** (Anthropic sem crédito, OpenRouter removido, prod real serve Gemini Flash, Gemini já caiu uma vez por `CONSUMER_SUSPENDED`); sem isolamento por corretor, billing ou base LGPD defensável; eval stale.

### Meta
Fundação mínima para acesso multi-usuário controlado: autenticação real, redundância de provider LLM e observabilidade — pré-requisito de qualquer ampliação além do piloto fechado.

### Entregas necessárias
- Auth real no dashboard (substituir mockup; gate nas rotas `(app)`), com allowlist de corretores do piloto.
- Redundância de LLM: recarregar Anthropic ou reintroduzir um provider pago estável; não depender de uma única chave Gemini. Documentar a cadeia real.
- Isolamento por `broker_id` (dados, conversas, rate limits).
- Observabilidade: persistência de uso (dashboard + WhatsApp), custo por corretor (`usage_costs`), alertas de falha de provider.
- Base LGPD: termo, retenção, hash de PII (já há `user_question_hash` em `retrieval_traces`).

### Critério de pronto
- Nenhuma rota de dados acessível sem auth.
- Cadeia LLM com ≥ 2 providers pagos saudáveis e failover testado.
- Uso e custo observáveis por corretor; alerta de provider down funcionando.

### Promessa segura intermediária
> "SOLOMON está em **piloto controlado** com corretores convidados (MAG+Prudential, cotação + consulta assistida). Acesso é restrito e monitorado."

### Riscos se pular
Sem auth: qualquer um com a URL lê dados de corretor → incidente LGPD. Sem redundância LLM: uma queda de chave derruba o produto inteiro (já aconteceu). Vender amplo sobre isso é vender um produto que cai e vaza.

### Sequência de PRs
1. **PR 5.1** (read-only) — auditoria de superfície aberta (rotas sem auth, dados expostos) + RLS advisories (já há 6 tabelas RLS-off no produto e 1 no hub).
2. **PR 5.2** (código) — auth real no dashboard + allowlist de corretores do piloto + gate nas rotas `(app)`.
3. **PR 5.3** (código) — redundância LLM + doc da cadeia real + alerta de provider down.
4. **PR 5.4** (código) — isolamento por `broker_id` + observabilidade de uso/custo + base LGPD.

---

## Mapa de dependências

```
Frente 5 (hardening) ──► habilita acesso seguro a qualquer ampliação
   │
   ├─► Frente 4 (garantia)  ──► eval fresco vira baseline das demais
   │       │
   │       ├─► Frente 1 (comparador)  ──► usa eval comparativo + decisão shadow
   │       │
   │       └─► Frente 3 (PDF on-demand)
   │
   └─► Frente 2 (pré-sinistro)  ──► último, maior consequência, fora do piloto
```

## Definição de "pronto para sair do piloto controlado"
Sair do piloto fechado para acesso mais amplo exige, no mínimo: Frente 5 fechada + Frente 4 fechada + Frente 1 no critério de pronto para os pares na whitelist. Pré-sinistro (Frente 2) e PDF on-demand (Frente 3) podem permanecer fora da promessa comercial mesmo após ampliação inicial.

---

## Próximo passo
Conforme issue #58: **primeiro o plano (este documento), depois PR por frente.** Nenhum código é implementado por este documento. A abertura de cada frente é um PR próprio, começando pelos PRs read-only (1.1, 2.1, 4.1, 5.1) que respeitam todos os guardrails acima.

*Fim do plano. Documento read-only — nenhuma alteração foi feita em produto, banco, embeddings, routing, deploy ou promessa comercial.*
