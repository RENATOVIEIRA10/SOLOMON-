---
phase: 9
plan: 09-01
subsystem: eval-trigger
tags: [security, eval, admin, queue, poller]
dependency_graph:
  requires: []
  provides: [eval-trigger-queue, admin-gate, eval-poller]
  affects: [app/src/lib/auth.ts, app/src/app/(app)/admin, app/eval/ragas]
tech_stack:
  added: []
  patterns: [admin-opt-in-gate, atomic-claim, subprocess-no-shell, polling-ui]
key_files:
  created:
    - app/src/app/api/admin/evals/trigger/route.ts
    - app/src/app/api/admin/evals/jobs/route.ts
    - app/src/components/admin/eval-trigger.tsx
    - app/eval/ragas/poll_eval_jobs.py
    - docs/ops/eval-trigger-queue.md
  modified:
    - app/src/lib/auth.ts
    - app/src/components/admin/eval-dashboard.tsx
    - app/src/app/(app)/admin/page.tsx
decisions:
  - isAdmin opt-in (false quando SOLOMON_ADMIN_EMAILS vazio), oposto do isAllowlisted que e aberto por padrao
  - poller usa subprocess.run sem shell=True; cmd como lista tipada
  - cron documentado mas NAO instalado automaticamente (operacao VPS manual)
  - EvalTrigger monta polling client-side de 8s (nao SSE) para manter simplicidade
metrics:
  duration: ~45min
  completed: 2026-06-13
  tasks_completed: 4
  files_created: 5
  files_modified: 3
---

# Phase 9 Plan 01: Eval Trigger Queue Summary

Fila web→VPS para disparar evals Ragas sem SSH: admin enfileira via dashboard, poller na VPS reivindica com claim atômico e executa `run_eval.py` com params validados em 2 camadas.

## Tasks Completadas

| Task | Nome | Commit | Arquivos |
|------|------|--------|----------|
| 1 | requireAdmin gate | 1b00fcc | app/src/lib/auth.ts |
| 2 | Endpoints trigger + jobs | 7c44787 | trigger/route.ts, jobs/route.ts |
| 3 | UI EvalTrigger + admin page gate | 4d40a16 | eval-trigger.tsx, eval-dashboard.tsx, admin/page.tsx |
| 4 | Poller VPS + docs operacionais | 91f7483 | poll_eval_jobs.py, docs/ops/eval-trigger-queue.md |

## Decisões Tomadas

**1. isAdmin opt-in (fail-safe closed)**
Admin gate retorna `false` quando `SOLOMON_ADMIN_EMAILS` não está definido. Contraste intencional com `isAllowlisted` que libera todos quando a env está vazia. Disparar eval custa dinheiro e roda processo na VPS — o padrão seguro é ninguém, não todos.

**2. Sem shell=True no poller**
`subprocess.run(cmd_list, shell=False)` elimina injeção de shell mesmo que um param malformado passe pela validação dupla. `JUDGE_BACKEND` vai via `env=`, não interpolado no comando.

**3. Cron documentado, não instalado**
O poller é idempotente e seguro para cron a cada 5 min, mas a instalação é operação manual na VPS (requer acesso ssh root + verificar que o venv existe). `docs/ops/eval-trigger-queue.md` tem a linha de crontab e o comando de instalação pronto.

**4. Polling UI 8s (não SSE)**
Polling simples com `setInterval` é mais fácil de manter e debug do que SSE. Evals levam minutos, 8s de delay é aceitável. Para quando status é `done` ou `failed`.

## Arquitetura de Segurança Implementada

| Vetor | Mitigação |
|-------|-----------|
| Não-admin dispara eval | `requireAdmin` gate em ambos endpoints (403) |
| Dados de eval visíveis a não-admin | `isAdmin` em `admin/page.tsx`, `EvalTrigger` condicional |
| Duplo disparo simultâneo | COUNT `status IN ('requested','running')` → 409 antes de inserir |
| Corrida entre pollers paralelos | `PATCH WHERE status='requested'` condicional — 0 linhas = outro pegou |
| Injeção via params | Whitelist judge + limit int em 2 camadas (app + poller) |
| RCE via web | Web só escreve linha; poller monta `[python, script, "--limit", str(N)]` sem `shell=True` |

## Deviations from Plan

None — plano executado exatamente como escrito.

## Known Stubs

None — nenhum dado hardcoded ou placeholder que impeça o objetivo do plano.

## Threat Flags

None — nenhuma superfície nova além do planejado no threat_model do plano.

## Self-Check: PASSED

Arquivos criados verificados:
- `app/src/app/api/admin/evals/trigger/route.ts` — FOUND (commit 7c44787)
- `app/src/app/api/admin/evals/jobs/route.ts` — FOUND (commit 7c44787)
- `app/src/components/admin/eval-trigger.tsx` — FOUND (commit 4d40a16)
- `app/eval/ragas/poll_eval_jobs.py` — FOUND (commit 91f7483)
- `docs/ops/eval-trigger-queue.md` — FOUND (commit 91f7483)

Commits verificados:
- 1b00fcc — FOUND (task 1)
- 7c44787 — FOUND (task 2)
- 4d40a16 — FOUND (task 3)
- 91f7483 — FOUND (task 4)

Build: `npm run build` exit 0 confirmado após cada task.
Python sintaxe: `ast.parse(poll_eval_jobs.py)` OK.
