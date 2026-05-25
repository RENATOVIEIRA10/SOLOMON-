-- Phase 5.3 P1: lock insurer_rate_tables (271k proprietary rate rows) from anon/authenticated.
-- App reads it only via service-role (rate-lookup.ts), which bypasses RLS.
-- Enable RLS with NO policy => deny-all for anon/authenticated; service_role unaffected.
--
-- Rollback: ALTER TABLE public.insurer_rate_tables DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurer_rate_tables ENABLE ROW LEVEL SECURITY;
