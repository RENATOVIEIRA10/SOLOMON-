-- =============================================================================
-- SOLOMON baseline snapshot
-- Generated: 2026-04-22 (timestamp UTC: 20260422180000)
-- Source: pg_catalog introspection of Supabase project ohmoyfbtfuznhlpjcbbk
--
-- PROPOSITO
-- Esta e a UNICA fonte de verdade do schema SOLOMON no repo. Substitui as
-- migrations 001-006 (prosa manual que nao foi aplicada via CLI) por um
-- snapshot idempotente do banco real.
--
-- APLICACAO
-- Esta migration e marcada como "applied" em supabase_migrations.schema_migrations
-- (version 20260422180000). O Supabase CLI pula migrations ja aplicadas, entao
-- rodar `supabase db push` nao vai re-executar este arquivo em producao.
-- Para clones (staging, local dev): o CLI aplica este baseline uma vez.
--
-- CONVENCAO FUTURA
-- Cada nova mudanca de schema gera UMA migration via `supabase migration new`
-- (formato YYYYMMDDHHMMSS). NAO editar este arquivo.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector     WITH SCHEMA public;
-- pg_graphql, pg_stat_statements, supabase_vault sao gerenciadas pelo Supabase.


-- -----------------------------------------------------------------------------
-- 2. Sequences (bigserial)
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.insurer_rate_tables_id_seq;


-- -----------------------------------------------------------------------------
-- 3. Helper / trigger functions
--    Criadas antes das triggers/policies que dependem delas.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_trail()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', NULL, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), NULL, auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_policy_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'pending'   AND NEW.status IN ('active', 'cancelled')) OR
    (OLD.status = 'active'    AND NEW.status IN ('expired', 'cancelled')) OR
    (OLD.status = 'expired'   AND NEW.status = 'active')
  ) THEN
    RAISE EXCEPTION 'Invalid policy status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_proposal_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'draft'    AND NEW.status IN ('sent', 'rejected')) OR
    (OLD.status = 'sent'     AND NEW.status IN ('viewed', 'rejected')) OR
    (OLD.status = 'viewed'   AND NEW.status IN ('accepted', 'rejected')) OR
    (OLD.status = 'accepted' AND NEW.status = 'rejected')
  ) THEN
    RAISE EXCEPTION 'Invalid proposal status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;


-- -----------------------------------------------------------------------------
-- 4. Tables
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.insurers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  cnpj text NOT NULL,
  opin_endpoint text,
  source text NOT NULL,
  logo_url text,
  active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.brokers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  auth_user_id uuid NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  cpf text,
  creci text,
  susep_number text,
  plan text DEFAULT 'free'::text NOT NULL,
  plan_started_at timestamptz,
  plan_expires_at timestamptz,
  queries_today integer DEFAULT 0 NOT NULL,
  queries_reset_at timestamptz,
  active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  insurer_id uuid NOT NULL,
  name text NOT NULL,
  code text,
  category text,
  modality text NOT NULL,
  susep_process text,
  terms_url text,
  raw_data jsonb,
  active boolean DEFAULT true NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.broker_clients (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  broker_id uuid NOT NULL,
  name text NOT NULL,
  cpf text,
  phone text,
  email text,
  birth_date date,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.coverages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL,
  type text NOT NULL,
  min_value numeric,
  max_value numeric,
  grace_period_days integer,
  excluded_risks text[],
  details jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid,
  insurer_id uuid,
  source_url text,
  source_type text NOT NULL,
  chunk_index integer DEFAULT 0 NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  metadata jsonb,
  content_hash text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  pdf_hash text,
  valid_from timestamptz DEFAULT now() NOT NULL,
  valid_until timestamptz,
  superseded_by uuid
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  broker_id uuid NOT NULL,
  channel text NOT NULL,
  message text NOT NULL,
  response text,
  sources jsonb,
  tokens_used integer,
  model text,
  latency_ms integer,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.conversation_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  broker_id uuid NOT NULL,
  rating smallint NOT NULL,
  flagged_issue text,
  comment text,
  channel text DEFAULT 'whatsapp'::text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.simulations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  broker_id uuid NOT NULL,
  type text NOT NULL,
  input_data jsonb,
  result_data jsonb,
  plan_a jsonb,
  plan_b jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.proposals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  broker_id uuid NOT NULL,
  broker_client_id uuid,
  simulation_id uuid,
  pdf_url text,
  status text DEFAULT 'draft'::text NOT NULL,
  sent_via text,
  sent_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.policies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  broker_client_id uuid NOT NULL,
  broker_id uuid NOT NULL,
  insurer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  policy_number text,
  start_date date,
  end_date date,
  capital numeric,
  monthly_premium numeric,
  beneficiaries jsonb,
  health_declaration jsonb,
  raw_file_url text,
  parsed_data jsonb,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.claim_analyses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  broker_id uuid NOT NULL,
  broker_client_id uuid,
  product_id uuid,
  event_type text NOT NULL,
  event_description text,
  policy_start_date date,
  verdict text NOT NULL,
  verdict_reason text,
  sources jsonb,
  checklist jsonb,
  risk_flags jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.pricing_tables (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  insurer_id uuid NOT NULL,
  product_code text NOT NULL,
  age_min integer NOT NULL,
  age_max integer NOT NULL,
  capital_min numeric NOT NULL,
  capital_max numeric NOT NULL,
  monthly_premium numeric NOT NULL,
  commission_rate numeric,
  uploaded_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.insurer_rate_tables (
  id bigint DEFAULT nextval('public.insurer_rate_tables_id_seq'::regclass) NOT NULL,
  insurer_id uuid NOT NULL,
  product_name text NOT NULL,
  product_code text NOT NULL,
  portfolio text,
  coverage_type text DEFAULT 'BASICA'::text NOT NULL,
  gender char(1) NOT NULL,
  age integer NOT NULL,
  period text,
  rate numeric NOT NULL,
  rate_unit text DEFAULT 'per_1000_annual'::text NOT NULL,
  source_doc_name text NOT NULL,
  source_page integer,
  version_label text,
  imported_at timestamptz DEFAULT now() NOT NULL
);
ALTER SEQUENCE public.insurer_rate_tables_id_seq OWNED BY public.insurer_rate_tables.id;

CREATE TABLE IF NOT EXISTS public.subscription_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  broker_id uuid NOT NULL,
  event_type text NOT NULL,
  old_plan text,
  new_plan text,
  metadata jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.alerts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  broker_id uuid,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  source_url text,
  read boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ingestion_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  source text NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  records_processed integer DEFAULT 0 NOT NULL,
  records_new integer DEFAULT 0 NOT NULL,
  records_updated integer DEFAULT 0 NOT NULL,
  error_message text,
  started_at timestamptz DEFAULT now() NOT NULL,
  finished_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  key text NOT NULL,
  endpoint text NOT NULL,
  response jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz DEFAULT (now() + '24:00:00'::interval) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz DEFAULT now() NOT NULL
);

-- Operational helpers (no RLS, no FKs)
CREATE TABLE IF NOT EXISTS public.pending_crawl_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  source_url text NOT NULL,
  insurer_name text,
  product_hint text,
  detected_date text,
  priority text DEFAULT 'medium'::text,
  status text DEFAULT 'pending'::text,
  notes text,
  added_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.pdf_version_detected (
  source_url text NOT NULL,
  insurer_name text,
  detected_date text,
  detected_yyyymm integer,
  extraction_method text,
  raw_hints text,
  detected_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rag_cleaner_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  batch_size integer NOT NULL,
  documents_processed integer DEFAULT 0,
  suggestions_created integer DEFAULT 0,
  errors integer DEFAULT 0,
  notes text
);

CREATE TABLE IF NOT EXISTS public.rag_cleaner_suggestions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  document_id uuid,
  content_hash text,
  issue_type text NOT NULL,
  severity text DEFAULT 'medium'::text,
  description text,
  suggested_action text,
  suggested_metadata jsonb,
  status text DEFAULT 'pending'::text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.documents_deleted_non_life (
  id uuid NOT NULL,
  insurer_id uuid,
  source_url text,
  source_type text,
  chunk_index integer,
  content text,
  metadata jsonb,
  content_hash text,
  delete_reason text,
  deleted_at timestamptz DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 5. Primary keys
-- -----------------------------------------------------------------------------
ALTER TABLE public.alerts                     ADD CONSTRAINT alerts_pkey                     PRIMARY KEY (id);
ALTER TABLE public.audit_log                  ADD CONSTRAINT audit_log_pkey                  PRIMARY KEY (id);
ALTER TABLE public.broker_clients             ADD CONSTRAINT broker_clients_pkey             PRIMARY KEY (id);
ALTER TABLE public.brokers                    ADD CONSTRAINT brokers_pkey                    PRIMARY KEY (id);
ALTER TABLE public.claim_analyses             ADD CONSTRAINT claim_analyses_pkey             PRIMARY KEY (id);
ALTER TABLE public.conversation_feedback      ADD CONSTRAINT conversation_feedback_pkey      PRIMARY KEY (id);
ALTER TABLE public.conversations              ADD CONSTRAINT conversations_pkey              PRIMARY KEY (id);
ALTER TABLE public.coverages                  ADD CONSTRAINT coverages_pkey                  PRIMARY KEY (id);
ALTER TABLE public.documents                  ADD CONSTRAINT documents_pkey                  PRIMARY KEY (id);
ALTER TABLE public.documents_deleted_non_life ADD CONSTRAINT documents_deleted_non_life_pkey PRIMARY KEY (id);
ALTER TABLE public.idempotency_keys           ADD CONSTRAINT idempotency_keys_pkey           PRIMARY KEY (id);
ALTER TABLE public.ingestion_logs             ADD CONSTRAINT ingestion_logs_pkey             PRIMARY KEY (id);
ALTER TABLE public.insurer_rate_tables        ADD CONSTRAINT insurer_rate_tables_pkey        PRIMARY KEY (id);
ALTER TABLE public.insurers                   ADD CONSTRAINT insurers_pkey                   PRIMARY KEY (id);
ALTER TABLE public.pdf_version_detected       ADD CONSTRAINT pdf_version_detected_pkey       PRIMARY KEY (source_url);
ALTER TABLE public.pending_crawl_queue        ADD CONSTRAINT pending_crawl_queue_pkey        PRIMARY KEY (id);
ALTER TABLE public.policies                   ADD CONSTRAINT policies_pkey                   PRIMARY KEY (id);
ALTER TABLE public.pricing_tables             ADD CONSTRAINT pricing_tables_pkey             PRIMARY KEY (id);
ALTER TABLE public.products                   ADD CONSTRAINT products_pkey                   PRIMARY KEY (id);
ALTER TABLE public.proposals                  ADD CONSTRAINT proposals_pkey                  PRIMARY KEY (id);
ALTER TABLE public.rag_cleaner_runs           ADD CONSTRAINT rag_cleaner_runs_pkey           PRIMARY KEY (id);
ALTER TABLE public.rag_cleaner_suggestions    ADD CONSTRAINT rag_cleaner_suggestions_pkey    PRIMARY KEY (id);
ALTER TABLE public.simulations                ADD CONSTRAINT simulations_pkey                PRIMARY KEY (id);
ALTER TABLE public.subscription_events        ADD CONSTRAINT subscription_events_pkey        PRIMARY KEY (id);


-- -----------------------------------------------------------------------------
-- 6. Unique constraints
-- -----------------------------------------------------------------------------
ALTER TABLE public.brokers              ADD CONSTRAINT brokers_auth_user_id_key              UNIQUE (auth_user_id);
ALTER TABLE public.brokers              ADD CONSTRAINT brokers_phone_key                     UNIQUE (phone);
ALTER TABLE public.documents            ADD CONSTRAINT documents_content_hash_chunk_index_key UNIQUE (content_hash, chunk_index);
ALTER TABLE public.idempotency_keys     ADD CONSTRAINT idempotency_keys_key_key              UNIQUE (key);
ALTER TABLE public.insurer_rate_tables  ADD CONSTRAINT insurer_rate_tables_unique            UNIQUE (insurer_id, product_name, product_code, coverage_type, gender, age, period, source_page);
ALTER TABLE public.insurers             ADD CONSTRAINT insurers_cnpj_key                     UNIQUE (cnpj);
ALTER TABLE public.insurers             ADD CONSTRAINT insurers_name_unique                  UNIQUE (name);
ALTER TABLE public.pending_crawl_queue  ADD CONSTRAINT pending_crawl_queue_source_url_key    UNIQUE (source_url);
ALTER TABLE public.products             ADD CONSTRAINT uq_products_insurer_code              UNIQUE (insurer_id, code);


-- -----------------------------------------------------------------------------
-- 7. Check constraints
-- -----------------------------------------------------------------------------
ALTER TABLE public.alerts                   ADD CONSTRAINT alerts_type_check                      CHECK ((type = ANY (ARRAY['product_change'::text, 'new_product'::text, 'regulatory'::text, 'expiring_policy'::text])));
ALTER TABLE public.audit_log                ADD CONSTRAINT audit_log_action_check                 CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])));
ALTER TABLE public.brokers                  ADD CONSTRAINT brokers_plan_check                     CHECK ((plan = ANY (ARRAY['free'::text, 'corretor'::text, 'consultor'::text, 'corretora'::text])));
ALTER TABLE public.claim_analyses           ADD CONSTRAINT claim_analyses_event_type_check        CHECK ((event_type = ANY (ARRAY['MORTE'::text, 'INVALIDEZ'::text, 'DOENCA_GRAVE'::text, 'DIT'::text, 'DIH'::text, 'FUNERAL'::text])));
ALTER TABLE public.claim_analyses           ADD CONSTRAINT claim_analyses_verdict_check           CHECK ((verdict = ANY (ARRAY['COBERTO'::text, 'NAO_COBERTO'::text, 'RISCO'::text])));
ALTER TABLE public.conversation_feedback    ADD CONSTRAINT conversation_feedback_channel_check   CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'dashboard'::text, 'api'::text])));
ALTER TABLE public.conversation_feedback    ADD CONSTRAINT conversation_feedback_flagged_issue_check CHECK ((flagged_issue = ANY (ARRAY['hallucination'::text, 'wrong_insurer'::text, 'outdated'::text, 'incomplete'::text, 'other'::text])));
ALTER TABLE public.conversation_feedback    ADD CONSTRAINT conversation_feedback_rating_check    CHECK (((rating >= 1) AND (rating <= 5)));
ALTER TABLE public.conversations            ADD CONSTRAINT conversations_channel_check            CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'dashboard'::text, 'api'::text])));
ALTER TABLE public.coverages                ADD CONSTRAINT coverages_type_check                   CHECK ((type = ANY (ARRAY['MORTE'::text, 'INVALIDEZ'::text, 'DOENCA_GRAVE'::text, 'DIT'::text, 'DIH'::text, 'FUNERAL'::text, 'AP'::text])));
ALTER TABLE public.documents                ADD CONSTRAINT documents_source_type_check            CHECK ((source_type = ANY (ARRAY['conditions_pdf'::text, 'susep'::text, 'news'::text, 'manual'::text])));
ALTER TABLE public.ingestion_logs           ADD CONSTRAINT ingestion_logs_source_check            CHECK ((source = ANY (ARRAY['opin'::text, 'crawler_site'::text, 'crawler_susep'::text, 'crawler_news'::text])));
ALTER TABLE public.ingestion_logs           ADD CONSTRAINT ingestion_logs_status_check            CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])));
ALTER TABLE public.insurer_rate_tables      ADD CONSTRAINT insurer_rate_tables_age_check         CHECK (((age >= 0) AND (age <= 120)));
ALTER TABLE public.insurer_rate_tables      ADD CONSTRAINT insurer_rate_tables_gender_check      CHECK ((gender = ANY (ARRAY['M'::bpchar, 'F'::bpchar])));
ALTER TABLE public.insurer_rate_tables      ADD CONSTRAINT insurer_rate_tables_rate_check        CHECK ((rate >= (0)::numeric));
ALTER TABLE public.insurer_rate_tables      ADD CONSTRAINT insurer_rate_tables_rate_unit_check   CHECK ((rate_unit = ANY (ARRAY['per_1000_annual'::text, 'per_1000_monthly'::text, 'per_1000_renda_monthly'::text, 'per_100_diaria_monthly'::text, 'fixed_brl_monthly'::text, 'flat_brl'::text, 'factor'::text])));
ALTER TABLE public.insurers                 ADD CONSTRAINT insurers_source_check                  CHECK ((source = ANY (ARRAY['opin'::text, 'crawler'::text, 'manual'::text])));
ALTER TABLE public.pending_crawl_queue      ADD CONSTRAINT pending_crawl_queue_priority_check    CHECK ((priority = ANY (ARRAY['urgent'::text, 'high'::text, 'medium'::text, 'low'::text])));
ALTER TABLE public.pending_crawl_queue      ADD CONSTRAINT pending_crawl_queue_status_check      CHECK ((status = ANY (ARRAY['pending'::text, 'crawling'::text, 'indexed'::text, 'failed'::text, 'skipped'::text])));
ALTER TABLE public.policies                 ADD CONSTRAINT policies_status_check                  CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'cancelled'::text, 'pending'::text])));
ALTER TABLE public.pricing_tables           ADD CONSTRAINT pricing_tables_check                   CHECK ((age_min <= age_max));
ALTER TABLE public.pricing_tables           ADD CONSTRAINT pricing_tables_check1                  CHECK ((capital_min <= capital_max));
ALTER TABLE public.pricing_tables           ADD CONSTRAINT pricing_tables_commission_rate_check  CHECK (((commission_rate IS NULL) OR ((commission_rate >= (0)::numeric) AND (commission_rate <= (1)::numeric))));
ALTER TABLE public.pricing_tables           ADD CONSTRAINT pricing_tables_monthly_premium_check  CHECK ((monthly_premium >= (0)::numeric));
ALTER TABLE public.products                 ADD CONSTRAINT products_modality_check                CHECK ((modality = ANY (ARRAY['VIDA'::text, 'FUNERAL'::text, 'AP'::text, 'PREVIDENCIA'::text])));
ALTER TABLE public.proposals                ADD CONSTRAINT proposals_sent_via_check               CHECK ((sent_via = ANY (ARRAY['whatsapp'::text, 'email'::text])));
ALTER TABLE public.proposals                ADD CONSTRAINT proposals_status_check                 CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'viewed'::text, 'accepted'::text, 'rejected'::text])));
ALTER TABLE public.rag_cleaner_suggestions  ADD CONSTRAINT rag_cleaner_suggestions_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));
ALTER TABLE public.rag_cleaner_suggestions  ADD CONSTRAINT rag_cleaner_suggestions_status_check   CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'applied'::text])));
ALTER TABLE public.simulations              ADD CONSTRAINT simulations_type_check                 CHECK ((type = ANY (ARRAY['upsell'::text, 'conquest'::text])));
ALTER TABLE public.subscription_events      ADD CONSTRAINT subscription_events_event_type_check  CHECK ((event_type = ANY (ARRAY['plan_activated'::text, 'plan_deactivated'::text, 'plan_upgraded'::text, 'plan_downgraded'::text, 'plan_expired'::text, 'payment_received'::text, 'payment_failed'::text])));


-- -----------------------------------------------------------------------------
-- 8. Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE public.alerts                ADD CONSTRAINT alerts_broker_id_fkey                FOREIGN KEY (broker_id)         REFERENCES public.brokers(id)        ON DELETE CASCADE;
ALTER TABLE public.broker_clients        ADD CONSTRAINT broker_clients_broker_id_fkey        FOREIGN KEY (broker_id)         REFERENCES public.brokers(id)        ON DELETE CASCADE;
ALTER TABLE public.brokers               ADD CONSTRAINT brokers_auth_user_id_fkey            FOREIGN KEY (auth_user_id)      REFERENCES auth.users(id)            ON DELETE CASCADE;
ALTER TABLE public.claim_analyses        ADD CONSTRAINT claim_analyses_broker_client_id_fkey FOREIGN KEY (broker_client_id)  REFERENCES public.broker_clients(id) ON DELETE SET NULL;
ALTER TABLE public.claim_analyses        ADD CONSTRAINT claim_analyses_broker_id_fkey        FOREIGN KEY (broker_id)         REFERENCES public.brokers(id)        ON DELETE CASCADE;
ALTER TABLE public.claim_analyses        ADD CONSTRAINT claim_analyses_product_id_fkey       FOREIGN KEY (product_id)        REFERENCES public.products(id)       ON DELETE SET NULL;
ALTER TABLE public.conversation_feedback ADD CONSTRAINT conversation_feedback_broker_id_fkey       FOREIGN KEY (broker_id)       REFERENCES public.brokers(id)       ON DELETE CASCADE;
ALTER TABLE public.conversation_feedback ADD CONSTRAINT conversation_feedback_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;
ALTER TABLE public.conversations         ADD CONSTRAINT conversations_broker_id_fkey         FOREIGN KEY (broker_id)         REFERENCES public.brokers(id)        ON DELETE CASCADE;
ALTER TABLE public.coverages             ADD CONSTRAINT coverages_product_id_fkey            FOREIGN KEY (product_id)        REFERENCES public.products(id)       ON DELETE CASCADE;
ALTER TABLE public.documents             ADD CONSTRAINT documents_insurer_id_fkey            FOREIGN KEY (insurer_id)        REFERENCES public.insurers(id)       ON DELETE SET NULL;
ALTER TABLE public.documents             ADD CONSTRAINT documents_product_id_fkey            FOREIGN KEY (product_id)        REFERENCES public.products(id)       ON DELETE SET NULL;
ALTER TABLE public.documents             ADD CONSTRAINT documents_superseded_by_fkey         FOREIGN KEY (superseded_by)     REFERENCES public.documents(id);
ALTER TABLE public.insurer_rate_tables   ADD CONSTRAINT insurer_rate_tables_insurer_id_fkey  FOREIGN KEY (insurer_id)        REFERENCES public.insurers(id)       ON DELETE CASCADE;
ALTER TABLE public.policies              ADD CONSTRAINT policies_broker_client_id_fkey       FOREIGN KEY (broker_client_id)  REFERENCES public.broker_clients(id) ON DELETE RESTRICT;
ALTER TABLE public.policies              ADD CONSTRAINT policies_broker_id_fkey              FOREIGN KEY (broker_id)         REFERENCES public.brokers(id)        ON DELETE RESTRICT;
ALTER TABLE public.policies              ADD CONSTRAINT policies_insurer_id_fkey             FOREIGN KEY (insurer_id)        REFERENCES public.insurers(id)       ON DELETE RESTRICT;
ALTER TABLE public.policies              ADD CONSTRAINT policies_product_id_fkey             FOREIGN KEY (product_id)        REFERENCES public.products(id)       ON DELETE RESTRICT;
ALTER TABLE public.pricing_tables        ADD CONSTRAINT pricing_tables_insurer_id_fkey       FOREIGN KEY (insurer_id)        REFERENCES public.insurers(id)       ON DELETE CASCADE;
ALTER TABLE public.pricing_tables        ADD CONSTRAINT pricing_tables_uploaded_by_fkey      FOREIGN KEY (uploaded_by)       REFERENCES public.brokers(id)        ON DELETE RESTRICT;
ALTER TABLE public.products              ADD CONSTRAINT products_insurer_id_fkey             FOREIGN KEY (insurer_id)        REFERENCES public.insurers(id)       ON DELETE RESTRICT;
ALTER TABLE public.proposals             ADD CONSTRAINT proposals_broker_client_id_fkey      FOREIGN KEY (broker_client_id)  REFERENCES public.broker_clients(id) ON DELETE SET NULL;
ALTER TABLE public.proposals             ADD CONSTRAINT proposals_broker_id_fkey             FOREIGN KEY (broker_id)         REFERENCES public.brokers(id)        ON DELETE CASCADE;
ALTER TABLE public.proposals             ADD CONSTRAINT proposals_simulation_id_fkey         FOREIGN KEY (simulation_id)     REFERENCES public.simulations(id)    ON DELETE SET NULL;
ALTER TABLE public.rag_cleaner_suggestions ADD CONSTRAINT rag_cleaner_suggestions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
ALTER TABLE public.simulations           ADD CONSTRAINT simulations_broker_id_fkey           FOREIGN KEY (broker_id)         REFERENCES public.brokers(id)        ON DELETE CASCADE;
ALTER TABLE public.subscription_events   ADD CONSTRAINT subscription_events_broker_id_fkey   FOREIGN KEY (broker_id)         REFERENCES public.brokers(id)        ON DELETE CASCADE;


-- -----------------------------------------------------------------------------
-- 9. Indexes (non-constraint)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_alerts_broker_id ON public.alerts USING btree (broker_id);
CREATE INDEX IF NOT EXISTS idx_alerts_type      ON public.alerts USING btree (type);
CREATE INDEX IF NOT EXISTS idx_alerts_unread    ON public.alerts USING btree (broker_id, read) WHERE (read = false);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at   ON public.audit_log USING btree (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by   ON public.audit_log USING btree (changed_by);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON public.audit_log USING btree (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_broker_clients_broker_id ON public.broker_clients USING btree (broker_id);
CREATE INDEX IF NOT EXISTS idx_broker_clients_cpf       ON public.broker_clients USING btree (cpf);
CREATE INDEX IF NOT EXISTS idx_brokers_active       ON public.brokers USING btree (active) WHERE (active = true);
CREATE INDEX IF NOT EXISTS idx_brokers_auth_user_id ON public.brokers USING btree (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_brokers_phone        ON public.brokers USING btree (phone);
CREATE INDEX IF NOT EXISTS idx_brokers_plan         ON public.brokers USING btree (plan);
CREATE INDEX IF NOT EXISTS idx_claim_analyses_broker_client_id ON public.claim_analyses USING btree (broker_client_id);
CREATE INDEX IF NOT EXISTS idx_claim_analyses_broker_id        ON public.claim_analyses USING btree (broker_id);
CREATE INDEX IF NOT EXISTS idx_claim_analyses_verdict          ON public.claim_analyses USING btree (verdict);
CREATE INDEX IF NOT EXISTS idx_feedback_broker       ON public.conversation_feedback USING btree (broker_id);
CREATE INDEX IF NOT EXISTS idx_feedback_conversation ON public.conversation_feedback USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created      ON public.conversation_feedback USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_issue        ON public.conversation_feedback USING btree (flagged_issue) WHERE (flagged_issue IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_feedback_rating       ON public.conversation_feedback USING btree (rating);
CREATE INDEX IF NOT EXISTS idx_conversations_broker_id  ON public.conversations USING btree (broker_id);
CREATE INDEX IF NOT EXISTS idx_conversations_channel    ON public.conversations USING btree (channel);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON public.conversations USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coverages_product_id ON public.coverages USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_coverages_type       ON public.coverages USING btree (type);
CREATE INDEX IF NOT EXISTS documents_embedding_idx      ON public.documents USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_documents_content_hash   ON public.documents USING btree (content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_embedding_hnsw ON public.documents USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64');
CREATE INDEX IF NOT EXISTS idx_documents_insurer_id     ON public.documents USING btree (insurer_id);
CREATE INDEX IF NOT EXISTS idx_documents_pdf_hash       ON public.documents USING btree (source_url, pdf_hash) WHERE (valid_until IS NULL);
CREATE INDEX IF NOT EXISTS idx_documents_product_id     ON public.documents USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_documents_source_type    ON public.documents USING btree (source_type);
CREATE INDEX IF NOT EXISTS idx_documents_validity       ON public.documents USING btree (insurer_id, valid_until) WHERE (valid_until IS NULL);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON public.idempotency_keys USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_logs_source     ON public.ingestion_logs USING btree (source);
CREATE INDEX IF NOT EXISTS idx_ingestion_logs_started_at ON public.ingestion_logs USING btree (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_logs_status     ON public.ingestion_logs USING btree (status);
CREATE INDEX IF NOT EXISTS insurer_rate_tables_lookup_idx       ON public.insurer_rate_tables USING btree (insurer_id, product_code, gender, age);
CREATE INDEX IF NOT EXISTS insurer_rate_tables_product_name_idx ON public.insurer_rate_tables USING gin (to_tsvector('portuguese'::regconfig, product_name));
CREATE INDEX IF NOT EXISTS idx_insurers_active ON public.insurers USING btree (active) WHERE (active = true);
CREATE INDEX IF NOT EXISTS idx_insurers_cnpj   ON public.insurers USING btree (cnpj);
CREATE INDEX IF NOT EXISTS idx_insurers_name   ON public.insurers USING btree (name);
CREATE INDEX IF NOT EXISTS idx_pending_crawl_priority ON public.pending_crawl_queue USING btree (priority) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_pending_crawl_status   ON public.pending_crawl_queue USING btree (status);
CREATE INDEX IF NOT EXISTS idx_policies_broker_client_id ON public.policies USING btree (broker_client_id);
CREATE INDEX IF NOT EXISTS idx_policies_broker_id        ON public.policies USING btree (broker_id);
CREATE INDEX IF NOT EXISTS idx_policies_end_date         ON public.policies USING btree (end_date) WHERE (status = 'active'::text);
CREATE INDEX IF NOT EXISTS idx_policies_insurer_id       ON public.policies USING btree (insurer_id);
CREATE INDEX IF NOT EXISTS idx_policies_product_id       ON public.policies USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_policies_status           ON public.policies USING btree (status);
CREATE INDEX IF NOT EXISTS idx_pricing_tables_age_range    ON public.pricing_tables USING btree (age_min, age_max);
CREATE INDEX IF NOT EXISTS idx_pricing_tables_insurer_id   ON public.pricing_tables USING btree (insurer_id);
CREATE INDEX IF NOT EXISTS idx_pricing_tables_product_code ON public.pricing_tables USING btree (product_code);
CREATE INDEX IF NOT EXISTS idx_pricing_tables_uploaded_by  ON public.pricing_tables USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_products_active        ON public.products USING btree (active) WHERE (active = true);
CREATE INDEX IF NOT EXISTS idx_products_insurer_id    ON public.products USING btree (insurer_id);
CREATE INDEX IF NOT EXISTS idx_products_modality      ON public.products USING btree (modality);
CREATE INDEX IF NOT EXISTS idx_products_susep_process ON public.products USING btree (susep_process);
CREATE INDEX IF NOT EXISTS idx_proposals_broker_client_id ON public.proposals USING btree (broker_client_id);
CREATE INDEX IF NOT EXISTS idx_proposals_broker_id        ON public.proposals USING btree (broker_id);
CREATE INDEX IF NOT EXISTS idx_proposals_simulation_id    ON public.proposals USING btree (simulation_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status           ON public.proposals USING btree (status);
CREATE INDEX IF NOT EXISTS idx_rag_cleaner_doc      ON public.rag_cleaner_suggestions USING btree (document_id);
CREATE INDEX IF NOT EXISTS idx_rag_cleaner_run      ON public.rag_cleaner_suggestions USING btree (run_id);
CREATE INDEX IF NOT EXISTS idx_rag_cleaner_severity ON public.rag_cleaner_suggestions USING btree (severity) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_rag_cleaner_status   ON public.rag_cleaner_suggestions USING btree (status);
CREATE INDEX IF NOT EXISTS idx_simulations_broker_id ON public.simulations USING btree (broker_id);
CREATE INDEX IF NOT EXISTS idx_simulations_type      ON public.simulations USING btree (type);
CREATE INDEX IF NOT EXISTS idx_subscription_events_broker_id  ON public.subscription_events USING btree (broker_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_created_at ON public.subscription_events USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_events_type       ON public.subscription_events USING btree (event_type);


-- -----------------------------------------------------------------------------
-- 10. Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_alerts_updated_at              BEFORE UPDATE ON public.alerts              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_broker_clients_updated_at      BEFORE UPDATE ON public.broker_clients      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_brokers_audit                  AFTER  INSERT OR DELETE OR UPDATE ON public.brokers                  FOR EACH ROW EXECUTE FUNCTION audit_trail();
CREATE TRIGGER trg_brokers_updated_at             BEFORE UPDATE ON public.brokers             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_claim_analyses_updated_at      BEFORE UPDATE ON public.claim_analyses      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_conversations_updated_at       BEFORE UPDATE ON public.conversations       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_coverages_updated_at           BEFORE UPDATE ON public.coverages           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_documents_updated_at           BEFORE UPDATE ON public.documents           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ingestion_logs_updated_at      BEFORE UPDATE ON public.ingestion_logs      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_insurers_updated_at            BEFORE UPDATE ON public.insurers            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_policies_audit                 AFTER  INSERT OR DELETE OR UPDATE ON public.policies                 FOR EACH ROW EXECUTE FUNCTION audit_trail();
CREATE TRIGGER trg_policies_status_transition     BEFORE UPDATE OF status ON public.policies                            FOR EACH ROW EXECUTE FUNCTION validate_policy_status_transition();
CREATE TRIGGER trg_policies_updated_at            BEFORE UPDATE ON public.policies            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_pricing_tables_updated_at      BEFORE UPDATE ON public.pricing_tables      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated_at            BEFORE UPDATE ON public.products            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_proposals_audit                AFTER  INSERT OR DELETE OR UPDATE ON public.proposals                FOR EACH ROW EXECUTE FUNCTION audit_trail();
CREATE TRIGGER trg_proposals_status_transition    BEFORE UPDATE OF status ON public.proposals                           FOR EACH ROW EXECUTE FUNCTION validate_proposal_status_transition();
CREATE TRIGGER trg_proposals_updated_at           BEFORE UPDATE ON public.proposals           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_simulations_updated_at         BEFORE UPDATE ON public.simulations         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_subscription_events_audit      AFTER  INSERT OR DELETE OR UPDATE ON public.subscription_events      FOR EACH ROW EXECUTE FUNCTION audit_trail();
CREATE TRIGGER trg_subscription_events_updated_at BEFORE UPDATE ON public.subscription_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 11. RPC / application functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_broker_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT id FROM brokers WHERE auth_user_id = auth.uid() LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_broker_activity_summary()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(u) ORDER BY last_active_ts DESC NULLS LAST) INTO result
  FROM (
    SELECT
      b.id AS broker_id,
      b.name AS nome,
      b.email,
      b.phone,
      b.plan,
      to_char(b.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS cadastro,
      to_char(la.last_active_ts AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS ultimo_uso,
      la.last_active_ts,
      la.fonte_ultimo_uso,
      CASE
        WHEN la.last_active_ts IS NULL THEN 'nunca'
        WHEN la.last_active_ts >= NOW() - INTERVAL '1 day' THEN 'hoje'
        WHEN la.last_active_ts >= NOW() - INTERVAL '7 days' THEN 'ativo_7d'
        WHEN la.last_active_ts >= NOW() - INTERVAL '30 days' THEN 'ativo_30d'
        WHEN la.last_active_ts >= NOW() - INTERVAL '60 days' THEN 'dormente'
        ELSE 'morto'
      END AS estado,
      (SELECT COUNT(*) FROM conversations WHERE broker_id = b.id AND created_at >= NOW() - INTERVAL '7 days') AS conversations_7d,
      (SELECT COUNT(*) FROM conversations WHERE broker_id = b.id AND created_at >= NOW() - INTERVAL '30 days') AS conversations_30d,
      (SELECT COUNT(*) FROM conversations WHERE broker_id = b.id) AS conversations_total,
      (SELECT COUNT(*) FROM simulations WHERE broker_id = b.id) AS simulations_total,
      (SELECT COUNT(*) FROM proposals WHERE broker_id = b.id) AS proposals_total,
      (SELECT COUNT(*) FROM claim_analyses WHERE broker_id = b.id) AS claims_total,
      (SELECT COUNT(*) FROM conversation_feedback WHERE broker_id = b.id) AS feedbacks_total,
      (SELECT COUNT(*) FROM broker_clients WHERE broker_id = b.id) AS clients_total,
      (SELECT COUNT(*) FROM alerts WHERE broker_id = b.id AND created_at >= NOW() - INTERVAL '7 days') AS alerts_7d
    FROM brokers b
    CROSS JOIN LATERAL (
      SELECT
        MAX(ts) AS last_active_ts,
        (ARRAY_AGG(fonte ORDER BY ts DESC NULLS LAST))[1] AS fonte_ultimo_uso
      FROM (
        SELECT MAX(created_at) AS ts, 'conversation' AS fonte FROM conversations WHERE broker_id = b.id
        UNION ALL
        SELECT MAX(created_at), 'simulation' FROM simulations WHERE broker_id = b.id
        UNION ALL
        SELECT MAX(created_at), 'proposal' FROM proposals WHERE broker_id = b.id
        UNION ALL
        SELECT MAX(created_at), 'claim_analysis' FROM claim_analyses WHERE broker_id = b.id
        UNION ALL
        SELECT MAX(created_at), 'feedback' FROM conversation_feedback WHERE broker_id = b.id
        UNION ALL
        SELECT MAX(created_at), 'broker_client' FROM broker_clients WHERE broker_id = b.id
        UNION ALL
        SELECT MAX(created_at), 'alert' FROM alerts WHERE broker_id = b.id
      ) srcs
      WHERE ts IS NOT NULL
    ) la
  ) u;
  RETURN COALESCE(result, '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pdfs_sem_data_detectada(p_limit integer DEFAULT 40)
 RETURNS TABLE(source_url text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT DISTINCT d.source_url
  FROM documents d
  WHERE d.source_type = 'conditions_pdf'
    AND d.source_url IS NOT NULL
    AND substring(d.source_url FROM '(20[0-9]{4})') IS NULL
    AND d.source_url NOT IN (SELECT source_url FROM pdf_version_detected)
  LIMIT p_limit
$function$;

CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 10,
  filter_insurer_id uuid DEFAULT NULL::uuid,
  filter_product_id uuid DEFAULT NULL::uuid,
  filter_source_type text DEFAULT NULL::text,
  filter_exclude_non_life boolean DEFAULT true,
  filter_tipo_produto text DEFAULT NULL::text
)
 RETURNS TABLE(id uuid, content text, similarity double precision, metadata jsonb, source_url text, source_type text, product_id uuid, insurer_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    d.id,
    d.content,
    1 - (d.embedding <=> query_embedding) AS similarity,
    d.metadata,
    d.source_url,
    d.source_type,
    d.product_id,
    d.insurer_id
  FROM documents d
  WHERE d.embedding IS NOT NULL
    AND d.valid_until IS NULL
    AND (filter_insurer_id IS NULL OR d.insurer_id = filter_insurer_id)
    AND (filter_product_id IS NULL OR d.product_id = filter_product_id)
    AND (filter_source_type IS NULL OR d.source_type = filter_source_type)
    AND (
      filter_exclude_non_life = false
      OR d.metadata->>'tipo_produto' IS NULL
      OR d.metadata->>'tipo_produto' NOT IN ('PGBL','VGBL','previdencia','capitalizacao','residencial','viagem','auto')
    )
    AND (filter_tipo_produto IS NULL OR d.metadata->>'tipo_produto' = filter_tipo_produto)
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
$function$;

CREATE OR REPLACE FUNCTION public.search_products(search_query text, max_results integer DEFAULT 10)
 RETURNS TABLE(product_id uuid, product_name text, product_code text, modality text, susep_process text, terms_url text, insurer_id uuid, insurer_name text, coverage_summary text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  words text[];
  word text;
  conditions text := '';
BEGIN
  words := array_agg(w) FROM (
    SELECT unnest(string_to_array(lower(search_query), ' ')) AS w
  ) sub WHERE length(w) >= 3;

  FOREACH word IN ARRAY COALESCE(words, ARRAY[lower(search_query)])
  LOOP
    IF conditions != '' THEN conditions := conditions || ' OR '; END IF;
    conditions := conditions || format(
      '(lower(i.name) LIKE %L OR lower(p.name) LIKE %L OR lower(p.susep_process) LIKE %L OR lower(c.type) LIKE %L)',
      '%' || word || '%', '%' || word || '%', '%' || word || '%', '%' || word || '%'
    );
  END LOOP;

  RETURN QUERY EXECUTE format(
    'SELECT
      p.id as product_id,
      p.name as product_name,
      p.code as product_code,
      p.modality,
      p.susep_process,
      p.terms_url,
      i.id as insurer_id,
      i.name as insurer_name,
      COALESCE(
        string_agg(DISTINCT
          c.type ||
          CASE WHEN c.grace_period_days IS NOT NULL AND c.grace_period_days > 0
            THEN '''' || c.grace_period_days || '''' ELSE '''' END ||
          CASE WHEN c.min_value IS NOT NULL
            THEN '''' || c.min_value::text || '''' ELSE '''' END ||
          CASE WHEN c.max_value IS NOT NULL
            THEN '''' || c.max_value::text || '''' ELSE '''' END,
          ''; ''
        ),
        ''Sem coberturas detalhadas''
      ) as coverage_summary
    FROM products p
    JOIN insurers i ON i.id = p.insurer_id
    LEFT JOIN coverages c ON c.product_id = p.id
    WHERE p.active = true AND (%s)
    GROUP BY p.id, p.name, p.code, p.modality, p.susep_process, p.terms_url, i.id, i.name
    LIMIT %s',
    conditions, max_results
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.supersede_document_versions(p_source_url text, p_insurer_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_count int;
BEGIN
  UPDATE documents
  SET valid_until = now()
  WHERE source_url = p_source_url
    AND insurer_id = p_insurer_id
    AND valid_until IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;


-- -----------------------------------------------------------------------------
-- 12. Row Level Security (enable + policies)
-- -----------------------------------------------------------------------------
ALTER TABLE public.alerts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brokers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claim_analyses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_tables        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events   ENABLE ROW LEVEL SECURITY;

CREATE POLICY alerts_select_own_or_global ON public.alerts FOR SELECT TO authenticated USING (((broker_id IS NULL) OR (broker_id = get_broker_id())));
CREATE POLICY alerts_update_own           ON public.alerts FOR UPDATE TO authenticated USING ((broker_id = get_broker_id())) WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY audit_log_deny_all          ON public.audit_log FOR SELECT TO authenticated USING (false);
CREATE POLICY broker_clients_delete_own   ON public.broker_clients FOR DELETE TO authenticated USING ((broker_id = get_broker_id()));
CREATE POLICY broker_clients_insert_own   ON public.broker_clients FOR INSERT TO authenticated WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY broker_clients_select_own   ON public.broker_clients FOR SELECT TO authenticated USING ((broker_id = get_broker_id()));
CREATE POLICY broker_clients_update_own   ON public.broker_clients FOR UPDATE TO authenticated USING ((broker_id = get_broker_id())) WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY brokers_select_own          ON public.brokers FOR SELECT TO authenticated USING ((auth_user_id = auth.uid()));
CREATE POLICY brokers_update_own          ON public.brokers FOR UPDATE TO authenticated USING ((auth_user_id = auth.uid())) WITH CHECK ((auth_user_id = auth.uid()));
CREATE POLICY claim_analyses_insert_own   ON public.claim_analyses FOR INSERT TO authenticated WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY claim_analyses_select_own   ON public.claim_analyses FOR SELECT TO authenticated USING ((broker_id = get_broker_id()));
CREATE POLICY broker_own_feedback_insert  ON public.conversation_feedback FOR INSERT TO public WITH CHECK ((broker_id IN ( SELECT brokers.id FROM brokers WHERE (brokers.auth_user_id = auth.uid()))));
CREATE POLICY broker_own_feedback_read    ON public.conversation_feedback FOR SELECT TO public USING ((broker_id IN ( SELECT brokers.id FROM brokers WHERE (brokers.auth_user_id = auth.uid()))));
CREATE POLICY conversations_insert_own    ON public.conversations FOR INSERT TO authenticated WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY conversations_select_own    ON public.conversations FOR SELECT TO authenticated USING ((broker_id = get_broker_id()));
CREATE POLICY coverages_select_authenticated      ON public.coverages FOR SELECT TO authenticated USING (true);
CREATE POLICY documents_select_authenticated      ON public.documents FOR SELECT TO authenticated USING (true);
CREATE POLICY idempotency_keys_deny_all           ON public.idempotency_keys FOR SELECT TO authenticated USING (false);
CREATE POLICY ingestion_logs_select_authenticated ON public.ingestion_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY insurers_select_authenticated       ON public.insurers FOR SELECT TO authenticated USING ((active = true));
CREATE POLICY policies_insert_own         ON public.policies FOR INSERT TO authenticated WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY policies_select_own         ON public.policies FOR SELECT TO authenticated USING ((broker_id = get_broker_id()));
CREATE POLICY policies_update_own         ON public.policies FOR UPDATE TO authenticated USING ((broker_id = get_broker_id())) WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY pricing_tables_insert_own            ON public.pricing_tables FOR INSERT TO authenticated WITH CHECK ((uploaded_by = get_broker_id()));
CREATE POLICY pricing_tables_select_authenticated  ON public.pricing_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY products_select_authenticated        ON public.products FOR SELECT TO authenticated USING ((active = true));
CREATE POLICY proposals_insert_own        ON public.proposals FOR INSERT TO authenticated WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY proposals_select_own        ON public.proposals FOR SELECT TO authenticated USING ((broker_id = get_broker_id()));
CREATE POLICY proposals_update_own        ON public.proposals FOR UPDATE TO authenticated USING ((broker_id = get_broker_id())) WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY simulations_insert_own      ON public.simulations FOR INSERT TO authenticated WITH CHECK ((broker_id = get_broker_id()));
CREATE POLICY simulations_select_own      ON public.simulations FOR SELECT TO authenticated USING ((broker_id = get_broker_id()));
CREATE POLICY subscription_events_select_own ON public.subscription_events FOR SELECT TO authenticated USING ((broker_id = get_broker_id()));


-- -----------------------------------------------------------------------------
-- 13. Comments
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.alerts              IS 'System notifications for brokers (null broker_id = global alert)';
COMMENT ON TABLE public.audit_log           IS 'Immutable audit trail. UPDATE and DELETE are revoked on this table.';
COMMENT ON TABLE public.broker_clients      IS 'End-clients managed by brokers, used for proposals and claim analyses';
COMMENT ON TABLE public.brokers             IS 'Life insurance brokers who subscribe to SOLOMON';
COMMENT ON TABLE public.claim_analyses      IS 'Pre-claim analysis: AI verdict on whether an event is covered';
COMMENT ON TABLE public.conversations       IS 'Oracle chat history per broker, storing prompt, response, sources, and usage metrics';
COMMENT ON TABLE public.coverages           IS 'Individual coverages within a product, with limits and exclusions';
COMMENT ON TABLE public.documents           IS 'Chunked document content with embeddings for semantic search (RAG)';
COMMENT ON TABLE public.idempotency_keys    IS 'Idempotency keys for webhooks and financial operations (24h TTL default)';
COMMENT ON TABLE public.ingestion_logs      IS 'Tracks each data ingestion run (OPIN sync, crawler, etc.)';
COMMENT ON TABLE public.insurer_rate_tables IS 'Taxas publicadas em tabelas de premios de seguradoras (per R$1.000 de capital segurado por default). Fonte: tabelas tecnicas oficiais anexadas a condicoes gerais.';
COMMENT ON TABLE public.insurers            IS 'Insurance companies (seguradoras) with OPIN API endpoints or crawler sources';
COMMENT ON TABLE public.policies            IS 'Insurance policies held by broker clients, with state machine on status';
COMMENT ON TABLE public.pricing_tables      IS 'Manual pricing tables uploaded by brokers for quote comparisons';
COMMENT ON TABLE public.products            IS 'Insurance products catalogued per insurer, versioned for change tracking';
COMMENT ON TABLE public.proposals           IS 'Proposal PDFs generated from simulations, with delivery tracking';
COMMENT ON TABLE public.simulations         IS 'Insurance simulations for upsell (existing client) or conquest (new client)';
COMMENT ON TABLE public.subscription_events IS 'Event sourcing log for subscription state changes';

-- END OF BASELINE
