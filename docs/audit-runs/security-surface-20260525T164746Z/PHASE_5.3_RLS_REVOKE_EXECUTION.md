# Phase 5.3 — RLS + REVOKE: execução (fecha os críticos da auditoria 5.1)

**Issue:** #58 (Frente 5.3) · **Base:** auditoria 5.1 (PR #60) · **Data:** 2026-05-25.
Aplicado direto no produto `ohmoyfbtfuznhlpjcbbk` via `apply_migration` (migrations versionadas em `app/supabase/migrations/`). Cada mudança: dry-run → SQL → rollback → prova anon/authenticated bloqueado → prova service-role/app OK.

**Premissa que de-risca tudo (verificada):** nenhum componente cliente faz `.from()`/`.rpc()` direto — o client anon só é usado para **auth** (login). Todo dado passa por `/api/*` com **service-role**. Logo, RLS nas tabelas de dados **não afeta o app** (service-role bypassa RLS).

**Guardrails respeitados:** sem mutar `documents`, sem read path RAG, sem corpus routing, sem promotion/canary/flip, sem Phase 2/3C.

---

## Tabela de provas (SET ROLE, contagem visível)

| Alvo | anon antes | anon/auth depois | service_role depois | Migration |
|---|---:|---:|---:|---|
| `insurer_rate_tables` (P1) | 271.978 | **0** | 271.978 | `..200000_p1` |
| `rag_cleaner_suggestions` (P4) | 340 | **0** | 340 | `..200300_p4` |
| `rag_cleaner_runs` (P4) | 44 | **0** | (bypass) | `..200300_p4` |
| `documents_deleted_non_life` (P4) | 2.777 | **0** | 2.777 | `..200300_p4` |
| `pdf_version_detected` (P4) | 136 | **0** | (bypass) | `..200300_p4` |
| `pending_crawl_queue` (P4) | 11 | **0** | 11 | `..200300_p4` |
| `ingestion_logs` (P5) | 6 (auth `USING true`) | **0** | (bypass) | `..200400_p5` |

## Funções SECURITY DEFINER (P2/P3) — `has_function_privilege`

| Função | anon antes | anon depois | auth depois | service_role depois |
|---|---|---|---|---|
| `supersede_document_versions(text,uuid)` | true | **false** | **false** | true |
| `increment_broker_queries(uuid)` | true | **false** | **false** | true |
| `get_broker_activity_summary()` | true | **false** | **false** | true |
| `audit_trail()` | true | **false** | **false** | true |
| `get_broker_id()` | true | true | true | true |

`get_broker_id()` é **mantido de propósito** — é o helper SECURITY DEFINER usado pelas RLS policies per-corretor (`broker_clients`, `conversations`, `policies`, `claim_analyses`, `simulations`, `proposals`, `alerts`, `subscription_events`). Revogar de `authenticated` quebraria a avaliação dessas policies. Ele só retorna o broker do próprio caller (anon → null), então é seguro.

> **Achado de processo:** o REVOKE inicial (só de `anon, authenticated`) foi **inócuo** porque `EXECUTE` é concedido a `PUBLIC` por padrão. A validação pós-mudança pegou isso; corrigido revogando de `PUBLIC` + `GRANT ... TO service_role` (migration `..200200`). É por isso que "validar depois de cada mudança" é obrigatório.

## P5 — policies amplas
- `pricing_tables`: SELECT era `USING (true)` (qualquer corretor lia de todos) → agora `uploaded_by = get_broker_id()` (per-corretor, espelha o INSERT). 0 linhas hoje; corrige vazamento latente.
- `ingestion_logs`: SELECT `USING (true)` removido → deny-all a authenticated (service-role lê).
- Demais tabelas PII (`broker_clients`, `conversations`, etc.) **já tinham** policies per-corretor (`broker_id = get_broker_id()`) — nada a fazer.
- `conversation_feedback`: role `{public}` mas `qual`/`with_check` exigem `auth.uid()` → anon vê **0** (provado). Seguro como está.

---

## Resultado nos advisors de segurança
- **`rls_disabled_in_public`: 6 → 0** (os 6 ERROR-level críticos eliminados).
- Restantes: `rls_enabled_no_policy` (INFO) nas tabelas deny-all — **postura segura intencional** (service-only); `function_search_path_mutable` (WARN, hardening); `get_broker_id` anon-executável (WARN, intencional p/ RLS); `extension vector in public` (WARN, cosmético); `auth_leaked_password_protection` desabilitado (WARN — habilitar no Dashboard).

## Achados 5.1 fechados
- ✅ Crítico #2: `insurer_rate_tables` RLS-off → fechado (P1).
- ✅ Crítico #3: `supersede_document_versions` anon-executável → fechado (P2).
- ✅ Alto #5: 5 tabelas internas RLS-off → fechado (P4).
- ✅ Alto #6: `increment_broker_queries` anon-executável → fechado (P3).
- ✅ Alto #7 / Médio #8: policies amplas / `conversation_feedback {public}` → escopadas/validadas (P5).
- (Crítico #1 IDOR + Alto #4 sem-auth já fechados na 5.2 / PR #61.)

## Rollback
Cada migration tem o rollback inline no topo. Reverter tudo: `DISABLE ROW LEVEL SECURITY` nas 6 tabelas + `GRANT EXECUTE ... TO anon, authenticated` nas 4 funções + recriar as 2 policies `USING (true)`. Nenhum dado foi mutado; reversão é só de grants/políticas.

## Follow-ups (fora do escopo 5.3)
- `function_search_path_mutable`: setar `search_path` nas funções (inclui `match_documents`/`match_shadow_documents`) — hardening.
- Habilitar leaked-password protection no Supabase Auth.
- (opcional) mover extensão `vector` para schema próprio.
