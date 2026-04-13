-- Migration: match_documents RPC function for semantic vector search
-- Requires: pgvector extension and documents table with embedding vector(1536)

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.75,
  match_count int DEFAULT 5,
  filter_insurer_id uuid DEFAULT NULL,
  filter_product_id uuid DEFAULT NULL,
  filter_source_type text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity float,
  metadata jsonb,
  source_url text,
  source_type text,
  product_id uuid,
  insurer_id uuid
)
LANGUAGE sql STABLE
AS $$
  SELECT
    d.id,
    d.content,
    1 - (d.embedding <=> query_embedding) as similarity,
    d.metadata,
    d.source_url,
    d.source_type,
    d.product_id,
    d.insurer_id
  FROM documents d
  WHERE d.embedding IS NOT NULL
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
    AND (filter_insurer_id IS NULL OR d.insurer_id = filter_insurer_id)
    AND (filter_product_id IS NULL OR d.product_id = filter_product_id)
    AND (filter_source_type IS NULL OR d.source_type = filter_source_type)
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$$;
