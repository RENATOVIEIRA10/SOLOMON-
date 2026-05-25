-- Phase 5.3 P2/P3 (step 1): revoke EXECUTE from anon/authenticated on exposed
-- SECURITY DEFINER functions. NOTE: this step alone is INEFFECTIVE because
-- EXECUTE defaults to PUBLIC — see the follow-up migration
-- 20260525200200_phase5_3_p2_p3_revoke_public_grant_service_role.sql which
-- revokes from PUBLIC too. Kept as a separate file to match the applied ledger.
REVOKE EXECUTE ON FUNCTION public.supersede_document_versions(text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_broker_queries(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_broker_activity_summary() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_trail() FROM anon, authenticated;
-- get_broker_id() intentionally NOT revoked: it is the SECURITY DEFINER helper
-- referenced by per-broker RLS policies; revoking from authenticated breaks them.
