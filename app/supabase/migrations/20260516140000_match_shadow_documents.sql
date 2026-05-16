-- Migration: match_shadow_documents
-- Date: 2026-05-16
-- Slice: Phase 2 PR 3B slice 3B.6.2
--
-- Adds the isolated retrieval function for the slice 3B.5 shadow corpus.
-- Mirrors match_documents' signature and return shape so the eval harness
-- (slice 3B.6.3) can dispatch one query embedding to BOTH functions and
-- diff the results.
--
-- Hard contract:
--   - match_documents (the production read path) is NOT edited by this
--     migration. answer.ts:629 and compare.ts continue to call the
--     untouched production function.
--   - match_shadow_documents reads ONLY shadow rows: the WHERE clause
--     requires valid_until = sentinel '1970-01-01T00:00:00Z',
--     metadata.shadow = true, and metadata.hash_scheme = 'url-aware-v1'.
--   - rag_exclude filter is preserved verbatim from match_documents so
--     any future rag_exclude flag on a shadow row is honored the same way.
--   - filter args identical to match_documents so the harness can pass
--     the same filter object to both functions without conditionals.
--
-- Rollback:
--   DROP FUNCTION public.match_shadow_documents(...).
--   The production match_documents function is untouched; dropping this
--   one cannot affect production retrieval.

CREATE OR REPLACE FUNCTION public.match_shadow_documents(
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
    -- Shadow corpus inversion of match_documents' inertness filter:
    -- shadow rows have a NON-NULL sentinel valid_until and prod rows
    -- have valid_until IS NULL. The two corpora are disjoint by
    -- construction.
    AND d.valid_until = '1970-01-01T00:00:00Z'::timestamptz
    AND d.metadata->>'shadow' = 'true'
    AND d.metadata->>'hash_scheme' = 'url-aware-v1'
    -- rag_exclude filter preserved verbatim from match_documents so a
    -- shadow row flagged with rag_exclude='true' is honored identically.
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

COMMENT ON FUNCTION public.match_shadow_documents IS
  'Phase 2 PR 3B.6.2: isolated retrieval over the slice 3B.5 shadow corpus only. Disjoint from match_documents (prod) by valid_until + metadata.shadow + hash_scheme filters. Not called by the production read path; consumed by the slice 3B.6.3 eval harness.';
