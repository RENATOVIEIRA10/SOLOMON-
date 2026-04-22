# Supabase Migrations

## Fonte de verdade

**O banco Supabase `ohmoyfbtfuznhlpjcbbk` é a SSoT do schema SOLOMON.**

Este diretório reflete exatamente o que existe no banco. Qualquer divergência é
bug no repo, não no banco.

## Baseline

`20260422180000_baseline_snapshot.sql` foi gerado em 2026-04-22 via
introspeção `pg_catalog` do banco em produção. Contém:

- 24 tabelas (com colunas, defaults, NOT NULL)
- 9 UNIQUEs, 31 CHECKs, 26 FKs, 24 PKs
- 67 índices (inclui `ivfflat` + `hnsw` em `documents.embedding` com dim 1536)
- 4 trigger functions + 21 triggers
- 6 RPCs da aplicação (`match_documents`, `search_products`,
  `get_broker_activity_summary`, `get_broker_id`, `get_pdfs_sem_data_detectada`,
  `supersede_document_versions`)
- RLS ligado em 18 tabelas + 31 policies
- Comments nas tabelas principais

Esta migration está marcada como `applied` em
`supabase_migrations.schema_migrations` no banco prod. `supabase db push` não
re-executa.

Para clones (staging, local dev), o CLI aplica o baseline uma única vez na
inicialização do banco.

## Convenção para mudanças futuras

1. Toda alteração de schema gera **uma** migration nova via:
   ```bash
   supabase migration new <nome_descritivo>
   ```
   O CLI cria um arquivo `YYYYMMDDHHMMSS_<nome>.sql` neste diretório.

2. Aplique em ordem: local → staging → prod via `supabase db push`.

3. **NÃO edite `20260422180000_baseline_snapshot.sql`.** Se precisar mudar
   algo que está no baseline, crie uma migration nova que faça o `ALTER`.

4. **NÃO crie arquivos com formato sequencial (`NNN_name.sql`).** Use sempre o
   formato timestamp do Supabase CLI.

5. Antes de commitar, regenere os types TypeScript:
   ```bash
   npx supabase gen types typescript --project-id ohmoyfbtfuznhlpjcbbk > src/types/database.ts
   ```

## Por que mudamos

Os 6 arquivos antigos (`001..006_*.sql`, deletados neste commit) eram prosa
manual que **nunca rodou via CLI**. O banco evoluiu por outro caminho (SQL
Editor + `execute_sql`), deixando o repo e o banco em drift permanente.

O baseline de 2026-04-22 corrige isso: repo e banco partem do mesmo ponto e
toda mudança daqui pra frente é rastreada via `schema_migrations`.
