# AGENTS.md - SOLOMON

## Identidade do projeto

- **Nome:** SOLOMON - oráculo de seguros de vida para corretores (cliente âncora: Julio)
- **Stack:** Next.js 16 + TypeScript + Supabase pgvector (`ohmoyfbtfuznhlpjcbbk`) + Claude API
- **Deploy:** Vercel (branch `master` -> `app/`) + PM2 VPS dev
- **Repo:** github.com/RENATOVIEIRA10/SOLOMON- (branch `master`, dash no nome do repo)
- **VPS:** 104.131.187.118, `/root/solomon/repo/`

## Estrutura

```text
app/
├── src/
│   ├── app/api/       - API routes Next.js (ask, compare, pre-sinistro)
│   └── services/rag/  - pipeline RAG: answer.ts, compare.ts, llm.ts, rate-lookup.ts
├── scripts/           - crawlers, ingestão, dedup
└── supabase/          - migrations, functions
```

## Comandos importantes

```bash
cd app && npm run dev    # Next.js dev
cd app && npm run build  # build produção
cd app && eslint .       # lint
```

## Arquitetura dos 3 trilhos

1. **Cotação determinística** (`rate-lookup.ts`) - fast-path zero LLM, F=1.00
2. **Oráculo conceitual** (`answer.ts` + `llm.ts`) - RAG pgvector + Claude Haiku 4.5
3. **Pré-sinistro** (`pre-sinistro.ts`) - Claude Sonnet 4.6, alta consequência jurídica

## Áreas críticas

- **RAG pipeline:** qualquer mudança em `match_documents()` RPC afeta todos os 3 trilhos
- **Embeddings:** `nomic-embed-text` local - mudança de modelo invalida base de 16k+ chunks
- **Schema migrations:** seguir SSoT `supabase migration new` com timestamp - nunca editar baseline
- **rag_exclude flag:** 65 chunks cod1645 marcados `rag_exclude`; o RPC `match_documents` JÁ filtra `metadata->>'rag_exclude' <> 'true'` (migration 20260423180000 — nota antiga de "bug conhecido" estava desatualizada)
- **Baseline Ragas:** F=0.717 / AC=0.414 / CP=0.531 - não trocar stack LLM sem re-baseline

## LLMs em uso

- Haiku 4.5 -> oráculo (latência, custo)
- Sonnet 4.6 -> pré-sinistro (qualidade, jurídico)
- `nomic-embed-text` -> embeddings (local, gratuito)

## Regras de revisão

- Mudanças em RAG/embeddings/schema -> adversarial-review obrigatório
- Mudanças em `pre-sinistro.ts` -> adversarial-review (consequência jurídica)
- Novos crawlers/ingestão -> review normal + verificar dedup
- Mudanças no frontend -> review normal
