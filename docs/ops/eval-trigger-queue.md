# Eval Trigger Queue — Operações

Sistema de fila para disparar evals Ragas pela web sem SSH manual.

---

## Schema — tabela `eval_jobs` (agentes-hub `zwnlpumonvkrghoxnddd`)

```sql
id          uuid        PK default gen_random_uuid()
project     text        -- 'solomon'
status      text        CHECK (status IN ('requested','running','done','failed'))
params      jsonb       -- { limit: int, judge: 'openai'|'gemini'|'anthropic', multiJudge: bool }
requested_by text       -- email do admin que disparou
run_id      text        -- timestamp YYYYMMDD_HHMMSS gerado pelo run_eval.py (null até done)
error       text        -- últimas linhas do stderr em caso de failed (null quando ok)
created_at  timestamptz default now()
updated_at  timestamptz -- trigger automático
```

RLS on, sem políticas de anon — apenas service_role acessa (igual `eval_runs`).

---

## Fluxo completo

```
[Admin via web]
  POST /api/admin/evals/trigger
    → valida limit (1..50) + judge whitelist + 409 anti-dupla-fila
    → INSERT eval_jobs status='requested'
    → retorna { id, status } 201

[VPS cron — a cada 5 min]
  poll_eval_jobs.py
    → GET eval_jobs WHERE project='solomon' AND status='requested' ORDER BY created_at LIMIT 1
    → PATCH status='running' WHERE id=X AND status='requested'  ← claim atômico
    → revalida params (defesa em profundidade)
    → subprocess.run(["python", "run_eval.py", "--limit", N, ...])  ← sem shell=True
    → captura run_id do stdout ("=== SOLOMON Ragas eval — TIMESTAMP ===")
    → PATCH status='done'  run_id=TIMESTAMP   (ou 'failed' + error)

[Dashboard web]
  GET /api/admin/evals/jobs  (polling 8s)
    → mostra requested→running→done/failed
    → quando done: linka run_id para ver na tabela eval_runs
```

---

## Instalação do cron na VPS

### 1. Verificar que o venv existe

```bash
ssh root@104.131.187.118
ls /root/solomon/repo/app/eval/ragas/.venv/bin/python
# Se não existir:
# cd /root/solomon/repo/app/eval/ragas && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```

### 2. Testar o poller manualmente (dry-run)

```bash
ssh root@104.131.187.118
cd /root/solomon/repo/app/eval/ragas
set -a && source /root/agents/config/.env && source /root/solomon/repo/app/.env.local && set +a
source .venv/bin/activate
python poll_eval_jobs.py --dry-run
```

### 3. Instalar o cron (1 comando)

```bash
# Abre o crontab e adiciona a linha abaixo:
crontab -e
```

Linha a adicionar:

```
*/5 * * * * /root/solomon/repo/app/eval/ragas/.venv/bin/python /root/solomon/repo/app/eval/ragas/poll_eval_jobs.py >> /var/log/solomon-eval-poller.log 2>&1
```

Ou, para instalar sem editor interativo:

```bash
(crontab -l 2>/dev/null; echo "*/5 * * * * cd /root/solomon/repo/app/eval/ragas && source /root/agents/config/.env && source /root/solomon/repo/app/.env.local && .venv/bin/python poll_eval_jobs.py >> /var/log/solomon-eval-poller.log 2>&1") | crontab -
```

> **Nota:** o poller precisa das envs `MANAGED_SUPABASE_URL`, `MANAGED_SUPABASE_KEY`
> (ou `SUPABASE_SERVICE_ROLE_KEY`) e as chaves de judge (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`).
> Essas vars estão em `/root/agents/config/.env` e `/root/solomon/repo/app/.env.local`.
> No cron, carregue os dois arquivos antes de rodar (veja linha de cron acima).

### 4. Verificar log

```bash
tail -f /var/log/solomon-eval-poller.log
```

---

## Segurança

| Vetor | Mitigação |
|-------|-----------|
| Admin não autorizado dispara eval | Gate `requireAdmin` (SOLOMON_ADMIN_EMAILS, opt-in, default ninguém) |
| Duplo disparo simultâneo | Anti-dupla-fila 409: conta `status IN ('requested','running')` antes de inserir |
| Corrida entre pollers paralelos | Claim atômico: `PATCH WHERE id=X AND status='requested'` — se 0 linhas, sai |
| Injeção via params | App valida (whitelist judge, limit int 1..50) E poller revalida (defesa em profundidade) |
| RCE via web | Web só escreve linha no banco; poller monta `cmd = [python, script, "--limit", str(N)]` sem `shell=True` |
| Params malformados no banco | Poller marca `failed` sem executar se params inválidos |

---

## Troubleshooting

**Job travado em 'running':** o poller pode ter morrido durante a execução. Corrigir manualmente:

```sql
-- Agentes-hub SQL
UPDATE eval_jobs
SET status = 'failed', error = 'poller morreu — reset manual'
WHERE id = '<uuid>' AND status = 'running';
```

**Verificar jobs ativos:**

```sql
SELECT id, status, params, requested_by, created_at, updated_at
FROM eval_jobs
WHERE project = 'solomon'
ORDER BY created_at DESC
LIMIT 10;
```

<!-- redeploy 2026-06-16T02:15Z: carregar SOLOMON_ADMIN_EMAILS -->
