-- Migration: Update fetch_chunks_by_toc to also match metadata.source_url
-- Date: 2026-06-05
-- Context: PageIndex Lite TOC seeds may derive source_doc from documents.metadata.source_url.

CREATE OR REPLACE FUNCTION public.fetch_chunks_by_toc(
  filter_insurer_id uuid,
  filter_product_id uuid,
  section_query text
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  source_url text,
  source_type text,
  product_id uuid,
  insurer_id uuid
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH matched_sections AS (
    SELECT toc.source_doc, toc.start_page, toc.end_page
    FROM public.document_toc toc
    WHERE toc.insurer_id = filter_insurer_id
      AND (filter_product_id IS NULL OR toc.product_id = filter_product_id)
      AND (toc.section_path ILIKE '%' || section_query || '%' OR toc.section_title ILIKE '%' || section_query || '%')
  )
  SELECT
    d.id,
    d.content,
    d.metadata,
    d.source_url,
    d.source_type,
    d.product_id,
    d.insurer_id
  FROM public.documents d
  JOIN matched_sections ms ON (coalesce(d.metadata->>'source_doc', d.metadata->>'source_url', d.source_url) = ms.source_doc)
  WHERE d.insurer_id = filter_insurer_id
    AND (filter_product_id IS NULL OR d.product_id = filter_product_id)
    AND (
      CASE
        WHEN d.metadata->>'page' ~ '^[0-9]+$' THEN (d.metadata->>'page')::integer
        ELSE -1
      END
    ) BETWEEN ms.start_page AND ms.end_page
    AND (d.metadata->>'rag_exclude' IS NULL OR d.metadata->>'rag_exclude' <> 'true')
  ORDER BY
    coalesce(d.metadata->>'source_doc', d.metadata->>'source_url', d.source_url),
    (
      CASE
        WHEN d.metadata->>'page' ~ '^[0-9]+$' THEN (d.metadata->>'page')::integer
        ELSE -1
      END
    ) ASC,
    d.chunk_index ASC;
END;
$$;
