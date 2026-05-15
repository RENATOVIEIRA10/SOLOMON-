# Phase 3 — Agentic RAG (referência arquitetural)

**Status**: registro de visão. Não é plano executável. Não muda PR 3B em curso. Não atrasa slice 3B.5.

## Origem

Compartilhado por CEO em 2026-05-15, junto com três referências visuais e um repositório:

- "What is an Agentic AI?" — comparativo LLM Chatbot / RPA / RAG vs. Agentic AI (Vectify AI)
- "RAG vs Agentic RAG" — DailyDoseofDS, fluxo com query writer / source selector / retrieval critic
- Arquitetura de `production-ai-app` — @shivanivirdi, academy.neosage.io, com `agents/`, `services/`, `tools/`, `evaluation/`, `observability/`
- PageIndex — https://github.com/VectifyAI/PageIndex

## Frase-âncora

> **Phase 2 estrutura a evidência. Phase 3 coloca agentes para raciocinar sobre essa evidência.**

Esta é a ordem. Agente em cima de chunk ruim só aumenta custo e complexidade — daí Phase 2 (chunker semântico + shadow set + gate Ragas) antes de qualquer scaffolding de Phase 3.

## Objetivo final SOLOMON

Agentic RAG com os componentes:

- **Query router** — decide qual trilho (cotação determinística / oráculo conceitual / pré-sinistro / fora-de-escopo)
- **Query rewriter** — expande query do corretor em sub-queries factíveis (ex.: "quanto custa o Vida Inteira para minha cliente 32 anos" → query estrutural sobre tabela de prêmio + query conceitual sobre coberturas)
- **Source selector** — escolhe entre embeddings (`conditions_pdf`), `rate_lookup` determinístico, page_index hierárquico, web search
- **Retrieval critic** — avalia se o contexto recuperado responde a pergunta antes de chamar LLM final
- **Retry loop** — re-roteia / re-busca quando critic reprova (ex.: troca insurer no scope, expande seção)
- **Citation validator** — verifica que cada claim sai do contexto recuperado (não alucina)
- **Answer critic** — avalia coerência e completude antes de devolver ao corretor
- **Memory/feedback** — preferências por corretor, padrões de erro, escalates do Julio
- **Observability/eval** — tracing por etapa, custo por trilho, RAGAS rolling com baseline

## Inspirações concretas

- **PageIndex** (VectifyAI) — retrieval hierárquico por documento/seção. Reforça a tese de que `page + section_path + clause_id` (chunk contract da PR 3B) é input necessário para navegação hierárquica do agente. Útil quando "ler seção X do doc Y" virar primitiva exposta ao agente.
- **Agentic RAG** (DailyDoseofDS) — orquestração com query writer, source selector, retrieval critic, retry loop. Alinhado com nosso roadmap; principal valor é evitar single-shot RAG em queries multifásicas (comparação entre seguradoras, decisão de cobertura em pré-sinistro).
- **production-ai-app** (@shivanivirdi) — modelo de organização de repo (`agents/document_grader.py`, `services/rag_pipeline.py`, `tools/vector_search.py`, `evaluation/golden_dataset.json`, `observability/tracer.py`). Quando Phase 3 começar, este é o esqueleto referência.

## Ordem (não negociável agora)

1. **3B.5** shadow-indexer Prudential — em andamento, depende de PR #21 mergear
2. **3B.6** embeddings sobre shadow set + harness de eval isolado
3. **B2** Ragas before/after — gate: `comparison` CP 0.13 → ≥0.50, CR → ≥0.45; `concept` CP → ≥0.55, CR → ≥0.50; sem regressão em `rate_*`
4. **B3 / B4** Promover (se B2 passar) ou rollback via `valid_until` (sem DELETE)
5. **Phase 2C** catalog seeding MAG (issue #22) — backlog paralelo
6. **Phase 3 — Agentic RAG** — esta nota vira plano executável apenas aqui

## Quando esta nota vira plano

**Gate**: depois de B2 passar e shadow set promovido. Antes disso, Agentic RAG é arquitetura sobre fundação não-validada. Risco: gastar capital de produto em agentes que ainda sofrem do chunk ruim que a PR 3B existe para corrigir — exatamente o anti-padrão que justifica fazer Phase 2 primeiro.

## O que NÃO fazer agora

- Não criar pasta `agents/` no repo
- Não introduzir Orchestrator LLM no pipeline atual
- Não trocar a arquitetura `rate-lookup.ts | answer.ts | pre-sinistro.ts | compare.ts` que está em produção
- Não adicionar query rewriter / source selector / retrieval critic em código
- Não fazer scaffolding de Phase 3 antes de B2
- Não comparar custos / SLAs de framework agentic (LangGraph, CrewAI, etc.) — escolha de framework é decisão dentro de Phase 3

## Notas de campo (sinais que apoiam o desenho)

- O `rate-lookup.ts` do trilho 1 já é "agent-like" — decide fast path determinístico antes de chamar LLM. Phase 3 generaliza esse padrão para um router de trilhos.
- O `compare.ts` (compareInsurers) já tem 2 chamadas LLM seriais (decompose + compare). Phase 3 expõe isso como agentes nomeados com contratos explícitos de entrada/saída e tracing per-step.
- Hermes (VPS) já roda como agente comandado por escalates (`/root/cockpit/tools/escalate.sh`). Padrão de mensagens entre agentes já existe na infra — Phase 3 escala isso para dentro do SOLOMON (in-process e cross-process).
- Multi-judge Ragas (PR Phase 1) já é um pré-padrão de "answer critic" — quando 2 judges divergem, é sinal de hard case que merece retry/escalate.

## Referências externas

- PageIndex: https://github.com/VectifyAI/PageIndex
- DailyDoseofDS — Agentic RAG: https://www.dailydoseofds.com/
- production-ai-app — academy.neosage.io
