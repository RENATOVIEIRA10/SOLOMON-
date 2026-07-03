-- Security hardening pré-piloto (T8 do plano 2026-07-02-piloto-lancamento-l1-l3)
-- Complementa a passada Phase 5.3 (2026-05-25): sales_leads ficou de fora dela,
-- e as functions RAG não fixam search_path (advisor "function_search_path_mutable").

-- P0 (advisor): sales_leads sem RLS. App acessa via service role; nenhuma policy = nega anon/authenticated.
alter table public.sales_leads enable row level security;

-- search_path fixo (anti privilege-escalation via search_path hijack).
-- Assinaturas recuperadas das migrations que definem cada function:
--   match_documents:        20260423180000_match_documents_exclude_rag_flagged.sql
--   match_shadow_documents: 20260516140000_match_shadow_documents.sql
--   fetch_chunks_by_toc:    20260605210000_fetch_chunks_by_toc_legacy_position.sql
-- (increment_broker_queries já nasce com SET search_path = public — 20260511150000.)
-- Extensão vector está no schema public (baseline linha 28), então public basta.
alter function public.match_documents(vector, double precision, integer, uuid, uuid, text, boolean, text)
  set search_path = public;
alter function public.match_shadow_documents(vector, double precision, integer, uuid, uuid, text, boolean, text)
  set search_path = public;
alter function public.fetch_chunks_by_toc(uuid, uuid, text)
  set search_path = public;
