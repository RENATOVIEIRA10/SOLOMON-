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
- LLM default (chat/oraculo/stream): **Claude Haiku 4.5** via OpenRouter (`anthropic/claude-haiku-4.5`). Motivo: custo ~3x menor que Sonnet e latencia em respostas conversacionais. Config em `app/src/services/rag/llm.ts`. Fallback chain: Gemini 2.0 Flash -> OpenAI GPT-4o-mini.
- LLM para pre-sinistro: **Claude Sonnet 4.6** (`anthropic/claude-sonnet-4.6`). Motivo: veredicto COBERTO/NAO_COBERTO/RISCO e decisao juridica de alta consequencia — custo extra (~R$0,02/analise) negligivel perto de erro em sinistro. Config em `app/src/services/rag/pre-sinistro.ts`.
- Chave OpenRouter em `app/.env.local` (gitignored). Nao trocar por OpenAI direto sem combinar com o user.
- pgvector + pdf-parse + react-pdf: atualizacoes de deps sao sensiveis (quebrou build no passado). Sempre testar `next build` local antes de push.
- Webhook Vercel (nao VPS): latencia aceitavel, cold start OK, escala sozinho. NAO migrar para VPS.
- Cliente Julio e stakeholder ancora — pendencias criticas em `shared/facts.md` do aurios-agents-workspace precisam ser fechadas antes de declarar SOLOMON "pronto".
- Dashboard corretor (phase 3+): componentes React em `app/src/components/`, servicos RAG em `app/src/services/rag/` (compare, pre-sinistro, stream).

## Idioma

Portugues. Codigo e termos tecnicos em ingles.
