-- Migration: document_toc and fetch_chunks_by_toc RPC
-- Date: 2026-06-04
-- Context: PageIndex Lite (Roadmap Ciclo 003) to enable direct SQL-based exaustive section retrieval.

CREATE TABLE IF NOT EXISTS public.document_toc (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id    uuid NOT NULL REFERENCES public.insurers(id) ON DELETE CASCADE,
  product_id    uuid REFERENCES public.products(id) ON DELETE CASCADE,
  source_doc    text NOT NULL,
  section_title text NOT NULL,
  section_path  text NOT NULL,
  start_page    integer NOT NULL,
  end_page      integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_page_range CHECK (start_page <= end_page)
);

COMMENT ON TABLE public.document_toc IS 'Table of Contents mapping page ranges to section titles/paths for exaustive metadata retrieval (PageIndex Lite)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_document_toc_insurer_product ON public.document_toc (insurer_id, product_id);
CREATE INDEX IF NOT EXISTS idx_document_toc_section_path ON public.document_toc USING gin (to_tsvector('portuguese', section_path));
CREATE INDEX IF NOT EXISTS idx_document_toc_source_doc ON public.document_toc (source_doc);

-- Enable RLS
ALTER TABLE public.document_toc ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_toc_select_authenticated"
  ON public.document_toc FOR SELECT TO authenticated
  USING (true);

-- Trigger for auto-updating updated_at
CREATE TRIGGER trg_document_toc_updated_at
  BEFORE UPDATE ON public.document_toc
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RPC Function to fetch chunks sequentially by TOC match
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
  JOIN matched_sections ms ON (d.metadata->>'source_doc' = ms.source_doc)
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
    d.metadata->>'source_doc', 
    (
      CASE 
        WHEN d.metadata->>'page' ~ '^[0-9]+$' THEN (d.metadata->>'page')::integer
        ELSE -1
      END
    ) ASC,
    d.chunk_index ASC;
END;
$$;
