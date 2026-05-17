-- Migration: retrieval_traces
-- Date: 2026-05-17
-- Slice: Phase 2 PR 3C-b (telemetry)
-- Design ref: docs/phase-2-pr3c-promotion-design.md sections 3.5, 3.7
--
-- Per-request retrieval-side telemetry fact table. Populated best-effort
-- by src/services/rag/retrieval-trace.ts from inside the search.ts
-- pipeline. Every retrieval (legacy or shadow) writes one row; failures
-- to insert must NEVER propagate to the user's request.
--
-- Hard contract for slice 3C-b:
--   - Table is created with all columns + 2 indexes.
--   - retention model: full-granularity 30 days, then weekly aggregation
--     (per CEO decision at PR #49 merge). The aggregation job is a
--     SEPARATE deferred slice; this migration only sets up the table.
--   - PII: user_question_hash holds sha256(question) only -- never the
--     raw text. Per CEO decision at PR #49 merge: v1 is hash-only.
--   - corpus column carries 'legacy' or 'shadow' (CHECK constraint).
--   - With slice 3C-a/b state (SHADOW_CORPUS_ALLOWLIST empty), every row
--     written will have corpus='legacy'.
--
-- Rollback:
--   DROP TABLE public.retrieval_traces;
--   Application code in retrieval-trace.ts catches all failures
--   silently; dropping the table makes inserts fail and they will be
--   logged as warnings but the user-facing request continues serving.
--
-- Guardrails honored:
--   - No DELETE (only INSERT writes; reads via service role)
--   - No mutation on `documents` or other existing tables
--   - No valid_until = NULL
--   - No PII stored in raw form (hash-only)

CREATE TABLE IF NOT EXISTS public.retrieval_traces (
  id bigserial PRIMARY KEY,
  request_id text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  user_question_hash text,
  insurer_name text,
  corpus text NOT NULL CHECK (corpus IN ('legacy', 'shadow')),
  mode text NOT NULL DEFAULT 'serve' CHECK (mode IN ('serve', 'preview-only')),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  chunks_returned integer NOT NULL CHECK (chunks_returned >= 0),
  fallback_used boolean NOT NULL DEFAULT false,
  fallback_reason text,
  rerank_used boolean NOT NULL DEFAULT false,
  source text NOT NULL
);

CREATE INDEX IF NOT EXISTS retrieval_traces_ts_desc
  ON public.retrieval_traces (ts DESC);

CREATE INDEX IF NOT EXISTS retrieval_traces_insurer_corpus_ts
  ON public.retrieval_traces (insurer_name, corpus, ts DESC);

-- Lock down to service_role + DB admin. Default Supabase pattern: enable
-- RLS with no policies. service_role bypasses RLS so retrieval-trace.ts
-- can still insert; anon/authenticated cannot read or mutate.
-- The contents (insurer_name, hash, latency, corpus) are observability
-- data; brokers should not be able to read each other's traces.
ALTER TABLE public.retrieval_traces ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.retrieval_traces IS
  'Per-retrieval telemetry. One row per call to semanticSearch*() in search.ts. Inserted best-effort from retrieval-trace.ts; insert failures are logged but never propagate. PII contract: user_question_hash is sha256(question), never raw text. Retention: 30 days granular then weekly aggregation (aggregation job deferred to a later slice).';

COMMENT ON COLUMN public.retrieval_traces.request_id IS
  'Caller-provided ID for cross-correlation with Langfuse / app logs. search.ts generates a UUID when caller does not pass one.';
COMMENT ON COLUMN public.retrieval_traces.user_question_hash IS
  'sha256(normalized question). PII safety: hash only. Raw text never stored in v1 (per CEO decision at PR #49 merge).';
COMMENT ON COLUMN public.retrieval_traces.corpus IS
  'Which RPC actually served the chunks. legacy = match_documents (production). shadow = match_shadow_documents (slice 3B.6.2).';
COMMENT ON COLUMN public.retrieval_traces.mode IS
  'serve = chunks returned to caller. preview-only = ran shadow alongside legacy but discarded shadow result (slice 3C-c). v1 only writes serve.';
COMMENT ON COLUMN public.retrieval_traces.fallback_used IS
  'true if the originally chosen corpus (e.g. shadow) failed and the code fell back to legacy. v1 (slice 3C-b) is always false because there is no auto-fallback yet.';
COMMENT ON COLUMN public.retrieval_traces.fallback_reason IS
  'When fallback_used=true: rpc_error | empty_result | flag_off | timeout. NULL otherwise.';
COMMENT ON COLUMN public.retrieval_traces.source IS
  'Which read-path caller invoked retrieval: ask | stream | compare | pre-sinistro | api-search | api-knowledge-search | unknown.';
