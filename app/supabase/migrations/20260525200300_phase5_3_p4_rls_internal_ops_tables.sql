-- Phase 5.3 P4: lock internal ops/crawler tables from anon/authenticated.
-- All read/written only by service-role (crawlers, cleaner, ingestion); no
-- client access. Enable RLS with NO policy => deny-all; service_role bypasses.
--
-- Rollback: ALTER TABLE public.<t> DISABLE ROW LEVEL SECURITY;  (per table)
ALTER TABLE public.rag_cleaner_suggestions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_cleaner_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents_deleted_non_life ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_version_detected       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_crawl_queue        ENABLE ROW LEVEL SECURITY;
