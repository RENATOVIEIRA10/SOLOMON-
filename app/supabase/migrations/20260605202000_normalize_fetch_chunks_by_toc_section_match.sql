-- Migration: Normalize fetch_chunks_by_toc section matching for Portuguese accents
-- Date: 2026-06-05
-- Context: PageIndex Lite queries use accentless section_query terms such as carenc.

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
  WITH normalized_query AS (
    SELECT lower(translate(
      section_query,
      U&'\00E1\00E0\00E2\00E3\00E4\00E9\00E8\00EA\00EB\00ED\00EC\00EE\00EF\00F3\00F2\00F4\00F5\00F6\00FA\00F9\00FB\00FC\00E7\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
    )) AS value
  ),
  matched_sections AS (
    SELECT toc.source_doc, toc.start_page, toc.end_page
    FROM public.document_toc toc
    CROSS JOIN normalized_query nq
    WHERE toc.insurer_id = filter_insurer_id
      AND (filter_product_id IS NULL OR toc.product_id = filter_product_id)
      AND (
        lower(translate(
          toc.section_path,
          U&'\00E1\00E0\00E2\00E3\00E4\00E9\00E8\00EA\00EB\00ED\00EC\00EE\00EF\00F3\00F2\00F4\00F5\00F6\00FA\00F9\00FB\00FC\00E7\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
        )) LIKE '%' || nq.value || '%'
        OR lower(translate(
          toc.section_title,
          U&'\00E1\00E0\00E2\00E3\00E4\00E9\00E8\00EA\00EB\00ED\00EC\00EE\00EF\00F3\00F2\00F4\00F5\00F6\00FA\00F9\00FB\00FC\00E7\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
        )) LIKE '%' || nq.value || '%'
      )
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
