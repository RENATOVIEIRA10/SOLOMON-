# Plano Fase 4 — Audit Loop Autonomo (qrag-clean apply + Ragas weekly)

**Data**: 2026-04-26
**Status**: spec'd, aguardando Fases 2+3 terminarem antes de iniciar
**Origem**: AGREGA ao plano novo existente (NAO substitui Fase 3 Reranker que ja estava no STATUS.md)

---

## Posicionamento (alinhado com STATUS.md secao 4)

Fase 4 fecha o ciclo qrag-clean iniciado em 24/04 (Hermes briefing 08h + sim-tier1 cron). Mapa atualizado das fases:

- **Fase 1 (entregue commit `257dbce`)**: Eval Stack — Ragas multi-judge + 5 metricas + persistencia agentes-hub + escalates Hermes
- **Fase 2 (planejada, P0-1 do STATUS.md, ~6h)**: round-robin per-entity em compare.ts + query decomposition com Haiku — ataca CR=0.15 em comparison
- **Fase 3 (planejada, ~5h)**: Reranker + Citations API — Cohere Rerank 3 multilingual em search.ts + Anthropic Citations em pre-sinistro.ts
- **Fase 4 (este spec, ~7-10 dias)**: Audit Loop Autonomo — cron semanal de auto-apply correcoes RAG com snapshot+rollback, fechando "detectar → aplicar → re-baseline"
- **Fase 5+ (futuro)**: dashboard UI no Admin AUR.IOs HQ + UI de fila qrag-clean

## Spec completo

PRD v1.0 detalhado em:
- `C:\Users\renato.aurelio\aurios-hq\docs\prd\solomon-audit-loop-2026-04-26.md`
- 5 epicos / 19 stories / ~75 pts / 7-10 dias dev
- 16 FRs com acceptance GIVEN/WHEN/THEN
- NFRs nas 6 categorias
- Rollout 4 fases (Phase 0 RPC fix → Phase 1 dry-run 2 sem → Phase 2 apply big bang → Phase 3 hardening)

Brief:
- `C:\Users\renato.aurelio\aurios-hq\docs\briefs\solomon-audit-loop-2026-04-26.md`

Memoria-indice:
- `~/.claude/projects/.../memory/project_solomon_audit_loop_brief.md`

## Decisoes ancora (entrevistas product-brief + prd 2026-04-26)

| Decisao | Valor |
|---|---|
| Cadencia | Semanal fixo, domingo 03h BRT |
| Scope MVP | 4 ops (1 exact-dup, 3 extraction Kimi, 4 coverage gap, 5 staleness) |
| Loop | Auto-apply tudo, blindado por snapshot+dry-run+rollback Ragas |
| Pre-requisito | Aplicar migration `match_documents_exclude_rag_flagged` (ja documentada em `project_solomon_retrieval_rag_exclude_fix.md`) |
| Notificacao | Telegram Hermes + sync_context audit_report + rag_cleaner_suggestions + escalate critical pra PII |
| Stack | VPS cron + bash `solomon-audit-cycle.sh` + qwen-client.sh + psql |
| Metrica primaria | Tier1 medio >= 4.0/5 sustentado 4 semanas |
| Rollout pos dry-run | Big bang nas 13 seguradoras (mesmo domingo) |
| Stakeholder Julio | Apenas informar via WhatsApp (nao bloquear em aprovacao) |
| Observabilidade | Langfuse Camada 1 AURIOS-GEST (FR-012) |
| Confiabilidade falha | Retry 3x backoff exponencial (5/15/45min), depois escalate critical |

## Reuso da infra existente (anti-teatro)

Premissa fundamental (CEO 2026-04-24): **nao criar mais sistemas paralelos**. Audit Loop reusa:

| Componente existente | Como Audit Loop reusa |
|---|---|
| `sim-tier1.sh` cron VPS (ja roda 03:30) | Audit Loop le tier1 baseline antes/depois de cada apply pra calcular delta |
| `qrag-clean.sh` cron VPS (ja roda 05:00) | Audit Loop substitui em parte: 4 ops do PRD cobrem o que qrag-clean faz hoje + adiciona apply automatico + snapshot/rollback |
| `solomon_progress.sh` Hermes briefing 08h | Audit Loop publica no mesmo `sync_context` que ja e lido por solomon_progress.sh — briefing ganha resumo audit cycle automaticamente |
| `escalate.sh <severity>` em /root/cockpit/tools/ | Audit Loop chama direto pra notif (nao reinventa canal) |
| Tabela `eval_runs` no agentes-hub (Fase 1 commit `257dbce`) | Audit Loop ROLLBACK CHECK le `eval_runs` pra calcular F1 antes/depois automaticamente — sem novo cron Ragas |
| Tabela `rag_cleaner_suggestions` (existente) | Audit Loop persiste cada achado nesta tabela, status pending→applied |

## Pre-requisitos pra iniciar Fase 4

1. **Fase 2 deve estar entregue** (resolve P0-1 comparison CP=0.18). Se Audit Loop entrar antes da Fase 2, snapshot+rollback opera sobre base ainda com bug estrutural — Ragas continua oscilando, rollback dispara falso-positivo.
2. **Fase 3 (Reranker + Citations) deve estar entregue ou em paralelo controlado**. Reranker muda o que retrieval traz, entao Audit Loop precisa baseline pos-reranker pra calibrar threshold rollback.
3. **Migration `match_documents_exclude_rag_flagged` aplicada** (documentada em memoria `project_solomon_retrieval_rag_exclude_fix.md`). Pode ser feita em qualquer momento — nao depende das Fases 2 ou 3.
4. **3 evals consecutivos com delta <2pp** (criterio "pronto" do STATUS.md secao 2). Sem estabilidade, baseline pra rollback nao e confiavel.

## Quando iniciar

Sinal verde para iniciar /gsd-plan-phase do Audit Loop:
- Fases 2 e 3 entregues + P0-1 fechado (comparison CP > 0.40)
- 3 evals consecutivos delta <2pp pos-Fase 3
- Migration RPC rag_exclude aplicada
- Julio revisou Q48-Q50

Estimativa CEO: ~3-4 semanas pos-conclusao Fase 2 (assumindo Fase 3 entra logo apos Fase 2).

## Quando NAO iniciar

- Se Fase 2 quebrar baseline (CR ou F caem) — atrasar Audit Loop, focar em estabilidade
- Se Hermes briefing virar fonte unica de verdade adequada — reavaliar se cron weekly automatico vale a pena
- Se Julio reportar caso real de erro grave em campo — atender o caso, nao o sistema