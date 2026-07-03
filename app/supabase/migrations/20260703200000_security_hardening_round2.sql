-- Security hardening rodada 2 (T9 — advisors pós-rodada 1, zero ERROR, fechando WARNs acionáveis)
-- Assinaturas levantadas via pg_get_function_identity_arguments em 2026-07-03.

-- search_path fixo nas 8 functions restantes flagadas por function_search_path_mutable
alter function public.set_updated_at() set search_path = public;
alter function public.audit_trail() set search_path = public;
alter function public.validate_policy_status_transition() set search_path = public;
alter function public.validate_proposal_status_transition() set search_path = public;
alter function public.get_broker_id() set search_path = public;
alter function public.search_products(text, integer) set search_path = public;
alter function public.supersede_document_versions(text, uuid) set search_path = public;
alter function public.get_pdfs_sem_data_detectada(integer) set search_path = public;

-- get_broker_id é SECURITY DEFINER e estava executável por anon/authenticated
-- (advisor anon_security_definer_function_executable). O app só a usa via service
-- role no server — revogar dos roles públicos.
revoke execute on function public.get_broker_id() from anon, authenticated;
revoke execute on function public.get_broker_id() from public; -- grant default a PUBLIC mantinha o acesso; revogado na raiz

-- WARNs deliberadamente NÃO tratados aqui (registrados):
--   extension_in_public (vector): mover schema do pgvector é mudança estrutural de risco — fora do escopo do piloto.
--   auth_leaked_password_protection: setting de Auth (HIBP), tratado via config, não SQL.
--   rls_enabled_no_policy (INFO): intencional — tabelas internas acessadas só via service role.
