-- Migration: corpus_routing
-- Date: 2026-05-17
-- Slice: Phase 2 PR 3C-b (telemetry)
-- Design ref: docs/phase-2-pr3c-promotion-design.md sections 3.2, 3.6, 3.9
--
-- Creates the runtime routing table for the shadow corpus promotion
-- design. Slice 3C-a (PR #50) shipped the chooseRetrievalCorpus helper
-- with a dbRouting parameter that is currently unwired. This migration
-- adds the table the helper will eventually consult; slice 3C-b only
-- creates and seeds it.
--
-- Hard contract for slice 3C-b:
--   - Table is created.
--   - One row inserted: Prudential, mode='legacy'. The table is NOT
--     empty (audit visibility from day 1) but ALSO does not route any
--     insurer to shadow.
--   - No application code reads this table yet. Slice 3C-c is the
--     earliest slice that may read it.
--   - This migration is purely additive. No ALTER on `documents` or any
--     existing table.
--
-- Rollback:
--   DROP TABLE public.corpus_routing;
--   No application code depends on this table in slice 3C-b, so dropping
--   it has zero production effect.
--
-- Guardrails honored:
--   - No DELETE
--   - No row mutation on `documents` (shadow rows untouched)
--   - No valid_until = NULL
--   - Default mode='legacy' for every row inserted/updated by anyone
--   - CHECK constraint forbids any value other than 'legacy' | 'shadow'

CREATE TABLE IF NOT EXISTS public.corpus_routing (
  insurer_name text PRIMARY KEY,
  mode text NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy', 'shadow')),
  mode_set_at timestamptz NOT NULL DEFAULT now(),
  mode_set_by text NOT NULL,
  notes text
);

COMMENT ON TABLE public.corpus_routing IS
  'Per-insurer runtime routing between legacy match_documents and the slice-3B shadow corpus (match_shadow_documents). Read by chooseRetrievalCorpus when slice 3C-c+ wires dbRouting. Slice 3C-b only seeds. Default mode is legacy; flipping a row to shadow is a deliberate, audit-trailed act (mode_set_by/at). Empty allowlist env still vetoes shadow regardless of this table -- AND-gate per design § 3.2.';

COMMENT ON COLUMN public.corpus_routing.insurer_name IS
  'Canonical insurer name produced by detectInsurers() (e.g. "Prudential"). Case-sensitive match.';
COMMENT ON COLUMN public.corpus_routing.mode IS
  'Active corpus for this insurer. CHECK constraint forbids values other than legacy | shadow.';
COMMENT ON COLUMN public.corpus_routing.mode_set_by IS
  'Identity that set the current mode. Free-text: e.g. "ceo", "oncall", "service:promotion-bot".';

-- Lock down to service_role + DB admin. Default Supabase pattern: enable
-- RLS with no policies. service_role bypasses RLS so the app (and SQL
-- migrations) still write; anon/authenticated cannot read or mutate.
-- This mirrors the convention of the existing `documents`, `audit_log`,
-- and `eval_runs` tables in this DB.
ALTER TABLE public.corpus_routing ENABLE ROW LEVEL SECURITY;

-- Seed: Prudential row exists from day 1 with mode=legacy. Audit
-- visibility from the start; the row is the same logical state as
-- "no row exists" (chooseRetrievalCorpus returns legacy in both
-- cases) but lets operators see the table is populated.
INSERT INTO public.corpus_routing (insurer_name, mode, mode_set_at, mode_set_by, notes)
VALUES (
  'Prudential',
  'legacy',
  now(),
  'migration:20260517190000_corpus_routing',
  'Initial seed at slice 3C-b. Flip to ''shadow'' requires CEO authorization + non-empty SHADOW_CORPUS_ALLOWLIST.'
)
ON CONFLICT (insurer_name) DO NOTHING;
