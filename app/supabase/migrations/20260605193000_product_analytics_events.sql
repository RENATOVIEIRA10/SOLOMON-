-- Migration: product_analytics_events
-- Date: 2026-06-05
-- Purpose: first-party product analytics for SOLOMON activation, retention,
-- AI usage, client workflow, feedback and revenue funnel events.
--
-- PII contract:
--   - Never store raw user questions, claim descriptions, CPF, phone, email or
--     free-form notes in this table.
--   - Store only product metadata, counters, ids and coarse operational
--     dimensions needed for funnels/cohorts/north-star dashboards.
--
-- Runtime contract:
--   - Application writes best-effort via service_role.
--   - Insert failures must never fail a user request.

CREATE TABLE IF NOT EXISTS public.product_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id uuid REFERENCES public.brokers(id) ON DELETE CASCADE,
  auth_user_id uuid,
  event_name text NOT NULL CHECK (
    event_name IN (
      'broker_profile_bootstrapped',
      'broker_profile_updated',
      'session_started',
      'conversation_started',
      'conversation_completed',
      'comparison_started',
      'comparison_completed',
      'pre_sinistro_analysis_started',
      'pre_sinistro_analysis_completed',
      'client_created',
      'client_updated',
      'client_deleted',
      'feedback_submitted',
      'quota_exceeded',
      'upgrade_viewed',
      'upgrade_started',
      'upgrade_completed',
      'payment_failed',
      'subscription_canceled'
    )
  ),
  source text NOT NULL DEFAULT 'server',
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_analytics_events_created_at
  ON public.product_analytics_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_analytics_events_name_created_at
  ON public.product_analytics_events (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_analytics_events_broker_created_at
  ON public.product_analytics_events (broker_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_analytics_events_auth_created_at
  ON public.product_analytics_events (auth_user_id, created_at DESC);

ALTER TABLE public.product_analytics_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.product_analytics_events IS
  'First-party SOLOMON product analytics event log. Service-role write/read only by default; no raw PII or raw prompts.';

COMMENT ON COLUMN public.product_analytics_events.event_name IS
  'Event taxonomy uses objeto_verbo_passado, e.g. conversation_started, client_created.';

COMMENT ON COLUMN public.product_analytics_events.properties IS
  'JSON metadata only. Do not store raw questions, claim descriptions, CPF, phone, email, names, or free-form notes.';
