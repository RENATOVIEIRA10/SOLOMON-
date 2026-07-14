# SOLOMON — contrato de sessao

Este arquivo e committed. Qualquer Claude em qualquer maquina le isto na primeira tool call.

## Identidade do projeto

- **Nome:** SOLOMON (assistente WhatsApp para corretores de seguros — cliente ancora Julio)
- **Supabase (produto):** `ohmoyfbtfuznhlpjcbbk` (pgvector + documentos de seguradoras)
- **Supabase (sync/comando):** `zwnlpumonvkrghoxnddd` (agentes-hub — painel multi-projeto)
- **Repo:** github.com/RENATOVIEIRA10/SOLOMON- (branch `master`, **NOTA: nome do repo tem dash final**)
- **Deploy:** Vercel (`app-atalaia.vercel.app`) a partir de `app/` neste repo — webhook SEMPRE Vercel, nunca VPS
- **PM2 (dev na VPS):** `solomon-web` (next dev -p 3004)
- **VPS:** 104.131.187.118, `/root/solomon/repo/` (checkout canonico)

## Estrutura

```
/root/solomon/repo/        <- git SOLOMON- master (este repo)
├── ecosystem.config.js    <- PM2 ops config versionado
├── plans/                 <- documentos de planejamento
├── app/                   <- Next.js 16 (webhook Vercel + dashboard corretor)
│   ├── src/
│   ├── supabase/
│   ├── scripts/
│   └── ...
└── CLAUDE.md              <- este arquivo
```

Nota: existe tambem `/root/solomon/app/` (sem git, timestamp antigo 2026-04-14) — e uma copia stale de dev pre-unificacao do repo. Nao usar, nao comitar de la. Candidato a limpeza: consolidar PM2 `solomon-web` apontando para `/root/solomon/repo/app/` e remover o `/root/solomon/app/` antigo.

## Arquitetura macro

SOLOMON tem **3 trilhos** que compartilham o mesmo retrieval (pgvector) mas usam pipelines diferentes:

1. **Cotacao deterministica** (`app/src/services/rag/rate-lookup.ts`) — fast-path zero LLM. Detecta produtos com tabela de premio (Prudential, MAG) e retorna calculo direto do DB. F=1.00 sempre.
2. **Oraculo conceitual** (`answer.ts` + `compare.ts` + `context-builder.ts` + `llm.ts`) — RAG vanilla pra perguntas sobre coberturas, exclusoes, comparativos. LLM = Claude Haiku 4.5.
3. **Pre-sinistro** (`pre-sinistro.ts`) — analisa evento + apolice, devolve veredicto COBERTO/NAO_COBERTO/RISCO + checklist. LLM = Claude Sonnet 4.6 (alta consequencia juridica).

**API routes principais:**
- `POST /api/ask` — entrada do oraculo (chat + comparison)
- `POST /api/ask/stream` — versao SSE (dashboard)
- `POST /api/pre-sinistro` — trilho 3
- `POST /api/webhook/whatsapp` — webhook Meta Cloud API
- `POST /api/compare` — trilho 2 path multi-insurer

**Fluxo eval e scoreboard** (instituido 2026-04-24):
- `STATUS.md` na raiz e o **scoreboard canonico** — atualizar a cada fase fechada.
- `app/eval/ragas/` tem 49 perguntas validadas por Julio (corretor ancora) e 5 metricas Ragas: faithfulness (F), answer_correctness (AC), context_precision (CP), context_recall (CR), noise_sensitivity (NS).
- Cada run grava 1 linha por pergunta na tabela `eval_runs` do agentes-hub (`zwnlpumonvkrghoxnddd`); views uteis: `eval_latest_scoreboard`, `eval_recent_regressions`.

**Ingestao de seguradoras** (`app/scripts/`):
- `ingest-opin.ts` — APIs Open Insurance (Prudential, Bradesco, etc.)
- `crawl-pdfs-playwright.ts` + `crawl-sites.ts` — MAG/MetLife/Azos (sem OPIN)
- `generate-missing-embeddings.ts` — backfill embedding pra chunks novos
- `crawl-news.ts` — noticias setor (CQCS, Segs)

## Abertura de sessao (OBRIGATORIO)

Na primeira resposta de TODA sessao nesta pasta, ANTES de qualquer outra coisa:

1. Ler ultimos 5 registros de `sync_context` no agentes-hub:
   ```sql
   SELECT source, event_type, content, created_at
   FROM sync_context
   WHERE metadata->>'project' = 'solomon'
   ORDER BY created_at DESC
   LIMIT 5
   ```
2. Mostrar resumo em 3-5 linhas: o que foi feito na ultima sessao, commits pendentes, alertas.
3. So depois responder ao pedido.

## Fechamento de sessao (OBRIGATORIO)

1. `git commit` + `git push origin master` (branch e `master`, nao `main`).
   - **Neste notebook Windows de trabalho**, `git push` HTTPS retorna 403 persistente (cred-manager corporativo). Usar `python scripts/push-via-api.py` — replica commit(s) via GitHub REST API (blob+tree+commit+ref). Token lido de `~/.git-credentials`. Nos outros ambientes (VPS, code-server), `git push` normal funciona.
2. Vercel redeploya automatico a partir do push (monitorar via dashboard ou `vercel logs`).
3. Edge functions Supabase (se houver): `npx supabase functions deploy <nome> --project-ref ohmoyfbtfuznhlpjcbbk`.
4. Migrations SQL em `app/supabase/migrations/`: aplicar via `apply_migration` E commitar o arquivo.
5. Escrever session_summary no agentes-hub:
   ```sql
   INSERT INTO sync_context (source, event_type, content, metadata)
   VALUES (
     '<notebook|vps|code-server>',
     'session_summary',
     '<resumo>',
     jsonb_build_object(
       'project', 'solomon',
       'tasks_done', '[...]'::jsonb,
       'commits', '[...]'::jsonb,
       'next_candidates', '[...]'::jsonb
     )
   )
   ```

## Regras de codigo deste repo

- Branch principal e `master`. NAO criar `main`.
- **Provider: OpenRouter-first (diretriz CEO 2026-07-14).** OpenRouter e a chave PRIMARIA em toda chamada de LLM; providers diretos entram so como fallback (resiliencia de transporte). Config em `app/src/services/rag/llm.ts`. Guardrail: 402/insufficient credits do OpenRouter loga `[CREDIT-ALERT]` distinto — a conta tem saldo mas NAO tem auto-recharge, entao um 402 silencioso vira alerta e cai pro fallback (nunca engole).
- LLM chat/oraculo/stream: **Claude Haiku 4.5 via OpenRouter** (`anthropic/claude-haiku-4.5`). Streaming SSE token-a-token via `callOpenRouterStream` (parsing testado em `openrouter-sse.test.ts`). Fallback chain: Anthropic SDK direto (Haiku) -> Gemini 2.5 Flash direto -> OpenAI GPT-4o-mini.
- LLM compare + pre-sinistro (via `callGeminiJson`): **`gemini-2.5-flash` via OpenRouter** (`google/gemini-2.5-flash`), fallback Gemini direto. **DRIFT conhecido:** o codigo usa `PRE_SINISTRO_MODEL`/`COMPARE_MODEL` = `gemini-2.5-flash` (env-overridable), NAO Claude Sonnet 4.6. Trocar pra Sonnet, se desejado, e decisao separada acoplada ao hardening de faithfulness do pre-sinistro — nao foi feita aqui (esta migracao so mudou o transporte pro gateway, preservando modelos).
- Chave OpenRouter (`OPENROUTER_API_KEY`) em `app/.env.local` (gitignored). Nao trocar provider/modelo sem combinar com o user.
- pgvector + pdf-parse + react-pdf: atualizacoes de deps sao sensiveis (quebrou build no passado). Sempre testar `next build` local antes de push.
- Webhook Vercel (nao VPS): latencia aceitavel, cold start OK, escala sozinho. NAO migrar para VPS.
- Cliente Julio e stakeholder ancora — pendencias criticas em `shared/facts.md` do aurios-agents-workspace precisam ser fechadas antes de declarar SOLOMON "pronto".
- Dashboard corretor (phase 3+): componentes React em `app/src/components/`, servicos RAG em `app/src/services/rag/` (compare, pre-sinistro, stream).

## Comandos comuns

Tudo a partir de `app/` (Next.js 16 + Turbopack, branch master):

```bash
cd app
npm run dev            # localhost:3000 (VPS roda em 3004 via PM2 solomon-web)
npm run build          # SEMPRE rodar antes de push (pgvector/pdf-parse quebram)
npm run lint
```

**Eval Ragas — sempre na VPS** (notebook 4GB nao aguenta paralelo):

```bash
ssh root@104.131.187.118
cd /root/solomon/repo/app/eval/ragas && source .venv/bin/activate
set -a && source /root/agents/config/.env && source /root/solomon/repo/app/.env.local && set +a

python run_eval.py                    # full 49 perguntas, judge default Anthropic
JUDGE_BACKEND=gemini python run_eval.py
python run_eval.py --multi-judge      # ensemble Gemini+Haiku, flag |delta|>0.2
python run_eval.py --limit 3          # smoke
python run_eval.py --skip-hub         # sem persistencia agentes-hub
```

**Migrations Supabase produto** (`ohmoyfbtfuznhlpjcbbk`): criar arquivo em `app/supabase/migrations/<YYYYMMDDHHMMSS>_<nome>.sql`, aplicar via `mcp__supabase__apply_migration` E commitar o arquivo. Migrations do agentes-hub (`zwnlpumonvkrghoxnddd`) NAO vao pro repo.

## Idioma

Portugues. Codigo e termos tecnicos em ingles.
