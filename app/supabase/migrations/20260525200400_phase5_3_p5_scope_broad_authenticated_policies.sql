-- Phase 5.3 P5: replace permissive `USING (true)` authenticated SELECT policies.
-- ingestion_logs: ops metadata, not end-user data -> remove broad read (service-role
-- still reads via RLS bypass).
DROP POLICY IF EXISTS ingestion_logs_select_authenticated ON public.ingestion_logs;

-- pricing_tables: per-broker data (uploaded_by). A `true` SELECT let any signed-in
-- broker read every broker's pricing tables. Scope it per-broker to match the
-- existing per-broker INSERT policy (uploaded_by = get_broker_id()).
DROP POLICY IF EXISTS pricing_tables_select_authenticated ON public.pricing_tables;
CREATE POLICY pricing_tables_select_own ON public.pricing_tables
  FOR SELECT TO authenticated
  USING (uploaded_by = get_broker_id());

-- Rollback:
--   CREATE POLICY ingestion_logs_select_authenticated ON public.ingestion_logs
--     FOR SELECT TO authenticated USING (true);
--   DROP POLICY IF EXISTS pricing_tables_select_own ON public.pricing_tables;
--   CREATE POLICY pricing_tables_select_authenticated ON public.pricing_tables
--     FOR SELECT TO authenticated USING (true);
