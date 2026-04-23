-- Migration: match_documents_exclude_rag_flagged
-- Date: 2026-04-23
-- Context: audit solomon-audit-exact-dup-prudential-202604231700 flagged 65 chunks
-- from local://prudential/tabela-premios-cod1645-v15-mar26.pdf as rate_table_raw_numeric
-- (numbers extracted without spaces, unusable for RAG). The flag metadata->>'rag_exclude'='true'
-- was planted but inert because match_documents did not filter it. Smoke test pre-fix confirmed
-- the top 10 neighbours of a flagged chunk returned 10/10 flagged chunks — retrieval was
-- serving garbage. This migration adds one WHERE clause to respect the flag.
--
-- Signature preserved (same arg list and return type) — zero breaking change to callers.
-- Rollback: re-apply previous definition without the new AND, or UPDATE metadata to strip
-- rag_exclude_* keys where rag_exclude_audit_ref='solomon-audit-exact-dup-prudential-202604231700'.

CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10,
  filter_insurer_id uuid DEFAULT NULL::uuid,
  filter_product_id uuid DEFAULT NULL::uuid,
  filter_source_type text DEFAULT NULL::text,
  filter_exclude_non_life boolean DEFAULT true,
  filter_tipo_produto text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid,
  content text,
  similarity double precision,
  metadata jsonb,
  source_url text,
  source_type text,
  product_id uuid,
  insurer_id uuid
)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    d.id,
    d.content,
    1 - (d.embedding <=> query_embedding) AS similarity,
    d.metadata,
    d.source_url,
    d.source_type,
    d.product_id,
    d.insurer_id
  FROM documents d
  WHERE d.embedding IS NOT NULL
    AND d.valid_until IS NULL
    AND (d.metadata->>'rag_exclude' IS NULL OR d.metadata->>'rag_exclude' <> 'true')
    AND (filter_insurer_id IS NULL OR d.insurer_id = filter_insurer_id)
    AND (filter_product_id IS NULL OR d.product_id = filter_product_id)
    AND (filter_source_type IS NULL OR d.source_type = filter_source_type)
    AND (
      filter_exclude_non_life = false
      OR d.metadata->>'tipo_produto' IS NULL
      OR d.metadata->>'tipo_produto' NOT IN ('PGBL','VGBL','previdencia','capitalizacao','residencial','viagem','auto')
    )
    AND (filter_tipo_produto IS NULL OR d.metadata->>'tipo_produto' = filter_tipo_produto)
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$function$;
