-- Phase 5.3 P2/P3 (step 2, effective): EXECUTE defaults to PUBLIC, so revoking
-- only from anon/authenticated was ineffective. Revoke from PUBLIC too, then
-- GRANT to service_role explicitly so the app (service-role) keeps calling them.
-- Trigger usage does not require the invoking role to hold EXECUTE.
--
-- Rollback: GRANT EXECUTE ON FUNCTION <fn> TO anon, authenticated;  (per function)
REVOKE EXECUTE ON FUNCTION public.supersede_document_versions(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.supersede_document_versions(text, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_broker_queries(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_broker_queries(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_broker_activity_summary() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_broker_activity_summary() TO service_role;

REVOKE EXECUTE ON FUNCTION public.audit_trail() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.audit_trail() TO service_role;
