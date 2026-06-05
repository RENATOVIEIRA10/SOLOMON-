-- ============================================================================
-- SOLOMON — AI Oracle for Life Insurance Brokers (Brazil)
-- Complete Supabase Schema
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 2. UTILITY FUNCTIONS
-- ============================================================================

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Immutable audit trail trigger
CREATE OR REPLACE FUNCTION audit_trail()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- State machine transition validator for policies
CREATE OR REPLACE FUNCTION validate_policy_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'pending'   AND NEW.status IN ('active', 'cancelled')) OR
    (OLD.status = 'active'    AND NEW.status IN ('expired', 'cancelled')) OR
    (OLD.status = 'expired'   AND NEW.status = 'active') -- reinstatement
  ) THEN
    RAISE EXCEPTION 'Invalid policy status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- State machine transition validator for proposals
CREATE OR REPLACE FUNCTION validate_proposal_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'draft'    AND NEW.status IN ('sent', 'rejected')) OR
    (OLD.status = 'sent'     AND NEW.status IN ('viewed', 'rejected')) OR
    (OLD.status = 'viewed'   AND NEW.status IN ('accepted', 'rejected')) OR
    (OLD.status = 'accepted' AND NEW.status = 'rejected') -- edge case: client reversal
  ) THEN
    RAISE EXCEPTION 'Invalid proposal status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. TABLES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- insurers: Insurance companies operating in Brazil
-- ---------------------------------------------------------------------------
CREATE TABLE insurers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  cnpj        text NOT NULL UNIQUE,
  opin_endpoint text,
  source      text NOT NULL CHECK (source IN ('opin', 'crawler', 'manual')),
  logo_url    text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE insurers IS 'Insurance companies (seguradoras) with OPIN API endpoints or crawler sources';

-- ---------------------------------------------------------------------------
-- products: Insurance products offered by insurers
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id    uuid NOT NULL REFERENCES insurers(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  code          text,
  category      text,
  modality      text NOT NULL CHECK (modality IN ('VIDA', 'FUNERAL', 'AP', 'PREVIDENCIA')),
  susep_process text,
  terms_url     text,
  raw_data      jsonb,
  active        boolean NOT NULL DEFAULT true,
  version       int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE products IS 'Insurance products catalogued per insurer, versioned for change tracking';

-- ---------------------------------------------------------------------------
-- coverages: Coverage details for each product
-- ---------------------------------------------------------------------------
CREATE TABLE coverages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('MORTE', 'INVALIDEZ', 'DOENCA_GRAVE', 'DIT', 'DIH', 'FUNERAL', 'AP')),
  min_value        numeric,
  max_value        numeric,
  grace_period_days int,
  excluded_risks   text[],
  details          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE coverages IS 'Individual coverages within a product, with limits and exclusions';

-- ---------------------------------------------------------------------------
-- documents: Chunked PDFs/content with vector embeddings for RAG
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  insurer_id    uuid REFERENCES insurers(id) ON DELETE SET NULL,
  source_url    text,
  source_type   text NOT NULL CHECK (source_type IN ('conditions_pdf', 'susep', 'news', 'manual')),
  chunk_index   int NOT NULL DEFAULT 0,
  content       text NOT NULL,
  embedding     vector(1536),
  metadata      jsonb,
  content_hash  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_hash, chunk_index)
);
COMMENT ON TABLE documents IS 'Chunked document content with embeddings for semantic search (RAG)';

-- ---------------------------------------------------------------------------
-- brokers: Subscribers / authenticated users (corretores de seguros)
-- ---------------------------------------------------------------------------
CREATE TABLE brokers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  phone           text NOT NULL UNIQUE,
  email           text,
  cpf             text,
  creci           text,
  susep_number    text,
  plan            text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'corretor', 'consultor', 'corretora')),
  plan_started_at timestamptz,
  plan_expires_at timestamptz,
  queries_today   int NOT NULL DEFAULT 0,
  queries_reset_at timestamptz,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE brokers IS 'Life insurance brokers who subscribe to SOLOMON';

-- ---------------------------------------------------------------------------
-- broker_clients: Clients managed by each broker
-- ---------------------------------------------------------------------------
CREATE TABLE broker_clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  cpf         text,
  phone       text,
  email       text,
  birth_date  date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE broker_clients IS 'End-clients managed by brokers, used for proposals and claim analyses';

-- ---------------------------------------------------------------------------
-- policies: Client insurance policies tracked by brokers
-- ---------------------------------------------------------------------------
CREATE TABLE policies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_client_id    uuid NOT NULL REFERENCES broker_clients(id) ON DELETE RESTRICT,
  broker_id           uuid NOT NULL REFERENCES brokers(id) ON DELETE RESTRICT,
  insurer_id          uuid NOT NULL REFERENCES insurers(id) ON DELETE RESTRICT,
  product_id          uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  policy_number       text,
  start_date          date,
  end_date            date,
  capital             numeric,
  monthly_premium     numeric,
  beneficiaries       jsonb,
  health_declaration  jsonb,
  raw_file_url        text,
  parsed_data         jsonb,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'expired', 'cancelled', 'pending')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE policies IS 'Insurance policies held by broker clients, with state machine on status';

-- ---------------------------------------------------------------------------
-- conversations: Chat history between brokers and the AI oracle
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('whatsapp', 'dashboard', 'api')),
  message     text NOT NULL,
  response    text,
  sources     jsonb,
  tokens_used int,
  model       text,
  latency_ms  int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE conversations IS 'Oracle chat history per broker, storing prompt, response, sources, and usage metrics';

-- ---------------------------------------------------------------------------
-- claim_analyses: Pre-sinistro analysis by the oracle
-- ---------------------------------------------------------------------------
CREATE TABLE claim_analyses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id         uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  broker_client_id  uuid REFERENCES broker_clients(id) ON DELETE SET NULL,
  product_id        uuid REFERENCES products(id) ON DELETE SET NULL,
  event_type        text NOT NULL CHECK (event_type IN ('MORTE', 'INVALIDEZ', 'DOENCA_GRAVE', 'DIT', 'DIH', 'FUNERAL')),
  event_description text,
  policy_start_date date,
  verdict           text NOT NULL CHECK (verdict IN ('COBERTO', 'NAO_COBERTO', 'RISCO')),
  verdict_reason    text,
  sources           jsonb,
  checklist         jsonb,
  risk_flags        jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE claim_analyses IS 'Pre-claim analysis: AI verdict on whether an event is covered';

-- ---------------------------------------------------------------------------
-- simulations: Upsell and Conquista simulations
-- ---------------------------------------------------------------------------
CREATE TABLE simulations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('upsell', 'conquest')),
  input_data  jsonb,
  result_data jsonb,
  plan_a      jsonb,
  plan_b      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE simulations IS 'Insurance simulations for upsell (existing client) or conquest (new client)';

-- ---------------------------------------------------------------------------
-- proposals: Generated proposal PDFs sent to clients
-- ---------------------------------------------------------------------------
CREATE TABLE proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id         uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  broker_client_id  uuid REFERENCES broker_clients(id) ON DELETE SET NULL,
  simulation_id     uuid REFERENCES simulations(id) ON DELETE SET NULL,
  pdf_url           text,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected')),
  sent_via          text CHECK (sent_via IN ('whatsapp', 'email')),
  sent_at           timestamptz,
  viewed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE proposals IS 'Proposal PDFs generated from simulations, with delivery tracking';

-- ---------------------------------------------------------------------------
-- pricing_tables: Manually uploaded pricing tables from insurers
-- ---------------------------------------------------------------------------
CREATE TABLE pricing_tables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id      uuid NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
  product_code    text NOT NULL,
  age_min         int NOT NULL,
  age_max         int NOT NULL,
  capital_min     numeric NOT NULL,
  capital_max     numeric NOT NULL,
  monthly_premium numeric NOT NULL,
  commission_rate numeric,
  uploaded_by     uuid NOT NULL REFERENCES brokers(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (age_min <= age_max),
  CHECK (capital_min <= capital_max),
  CHECK (monthly_premium >= 0),
  CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1))
);
COMMENT ON TABLE pricing_tables IS 'Manual pricing tables uploaded by brokers for quote comparisons';

-- ---------------------------------------------------------------------------
-- alerts: System alerts for brokers (product changes, regulatory, expiring)
-- ---------------------------------------------------------------------------
CREATE TABLE alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   uuid REFERENCES brokers(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('product_change', 'new_product', 'regulatory', 'expiring_policy')),
  title       text NOT NULL,
  message     text NOT NULL,
  source_url  text,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE alerts IS 'System notifications for brokers (null broker_id = global alert)';

-- ---------------------------------------------------------------------------
-- ingestion_logs: Track data ingestion pipeline runs
-- ---------------------------------------------------------------------------
CREATE TABLE ingestion_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text NOT NULL CHECK (source IN ('opin', 'crawler_site', 'crawler_susep', 'crawler_news')),
  status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  records_processed int NOT NULL DEFAULT 0,
  records_new       int NOT NULL DEFAULT 0,
  records_updated   int NOT NULL DEFAULT 0,
  error_message     text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE ingestion_logs IS 'Tracks each data ingestion run (OPIN sync, crawler, etc.)';

-- ---------------------------------------------------------------------------
-- audit_log: Immutable audit trail — NO updates or deletes allowed
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  text NOT NULL,
  record_id   uuid NOT NULL,
  action      text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE audit_log IS 'Immutable audit trail. UPDATE and DELETE are revoked on this table.';

-- Revoke UPDATE and DELETE on audit_log to enforce immutability
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_log FROM authenticated;
REVOKE UPDATE, DELETE ON audit_log FROM anon;

-- ---------------------------------------------------------------------------
-- subscription_events: Event sourcing for broker subscription lifecycle
-- ---------------------------------------------------------------------------
CREATE TABLE subscription_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN (
    'plan_activated', 'plan_deactivated', 'plan_upgraded',
    'plan_downgraded', 'plan_expired', 'payment_received', 'payment_failed'
  )),
  old_plan    text,
  new_plan    text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE subscription_events IS 'Event sourcing log for subscription state changes';

-- ---------------------------------------------------------------------------
-- product_analytics_events: First-party product analytics event log
-- ---------------------------------------------------------------------------
CREATE TABLE product_analytics_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id    uuid REFERENCES brokers(id) ON DELETE CASCADE,
  auth_user_id uuid,
  event_name   text NOT NULL CHECK (event_name IN (
    'broker_profile_bootstrapped', 'broker_profile_updated',
    'session_started', 'conversation_started', 'conversation_completed',
    'comparison_started', 'comparison_completed',
    'pre_sinistro_analysis_started', 'pre_sinistro_analysis_completed',
    'client_created', 'client_updated', 'client_deleted',
    'feedback_submitted', 'quota_exceeded',
    'upgrade_viewed', 'upgrade_started', 'upgrade_completed',
    'payment_failed', 'subscription_canceled'
  )),
  source       text NOT NULL DEFAULT 'server',
  properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE product_analytics_events IS
  'First-party SOLOMON product analytics event log. Service-role write/read only by default; no raw PII or raw prompts.';
COMMENT ON COLUMN product_analytics_events.event_name IS
  'Event taxonomy uses objeto_verbo_passado, e.g. conversation_started, client_created.';
COMMENT ON COLUMN product_analytics_events.properties IS
  'JSON metadata only. Do not store raw questions, claim descriptions, CPF, phone, email, names, or free-form notes.';

-- ---------------------------------------------------------------------------
-- idempotency_keys: Prevent duplicate webhook/financial processing
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  endpoint    text NOT NULL,
  response    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
COMMENT ON TABLE idempotency_keys IS 'Idempotency keys for webhooks and financial operations (24h TTL default)';

-- ============================================================================
-- 4. INDEXES
-- ============================================================================

-- insurers
CREATE INDEX idx_insurers_cnpj ON insurers (cnpj);
CREATE INDEX idx_insurers_name ON insurers (name);
CREATE INDEX idx_insurers_active ON insurers (active) WHERE active = true;

-- products
CREATE INDEX idx_products_insurer_id ON products (insurer_id);
CREATE INDEX idx_products_modality ON products (modality);
CREATE INDEX idx_products_susep_process ON products (susep_process);
CREATE INDEX idx_products_active ON products (active) WHERE active = true;

-- coverages
CREATE INDEX idx_coverages_product_id ON coverages (product_id);
CREATE INDEX idx_coverages_type ON coverages (type);

-- documents
CREATE INDEX idx_documents_product_id ON documents (product_id);
CREATE INDEX idx_documents_insurer_id ON documents (insurer_id);
CREATE INDEX idx_documents_source_type ON documents (source_type);
CREATE INDEX idx_documents_content_hash ON documents (content_hash);

-- HNSW index for vector similarity search on documents
CREATE INDEX idx_documents_embedding_hnsw ON documents
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- brokers
CREATE INDEX idx_brokers_auth_user_id ON brokers (auth_user_id);
CREATE INDEX idx_brokers_phone ON brokers (phone);
CREATE INDEX idx_brokers_plan ON brokers (plan);
CREATE INDEX idx_brokers_active ON brokers (active) WHERE active = true;

-- broker_clients
CREATE INDEX idx_broker_clients_broker_id ON broker_clients (broker_id);
CREATE INDEX idx_broker_clients_cpf ON broker_clients (cpf);

-- policies
CREATE INDEX idx_policies_broker_id ON policies (broker_id);
CREATE INDEX idx_policies_broker_client_id ON policies (broker_client_id);
CREATE INDEX idx_policies_insurer_id ON policies (insurer_id);
CREATE INDEX idx_policies_product_id ON policies (product_id);
CREATE INDEX idx_policies_status ON policies (status);
CREATE INDEX idx_policies_end_date ON policies (end_date) WHERE status = 'active';

-- conversations
CREATE INDEX idx_conversations_broker_id ON conversations (broker_id);
CREATE INDEX idx_conversations_channel ON conversations (channel);
CREATE INDEX idx_conversations_created_at ON conversations (created_at DESC);

-- claim_analyses
CREATE INDEX idx_claim_analyses_broker_id ON claim_analyses (broker_id);
CREATE INDEX idx_claim_analyses_broker_client_id ON claim_analyses (broker_client_id);
CREATE INDEX idx_claim_analyses_verdict ON claim_analyses (verdict);

-- simulations
CREATE INDEX idx_simulations_broker_id ON simulations (broker_id);
CREATE INDEX idx_simulations_type ON simulations (type);

-- proposals
CREATE INDEX idx_proposals_broker_id ON proposals (broker_id);
CREATE INDEX idx_proposals_broker_client_id ON proposals (broker_client_id);
CREATE INDEX idx_proposals_simulation_id ON proposals (simulation_id);
CREATE INDEX idx_proposals_status ON proposals (status);

-- pricing_tables
CREATE INDEX idx_pricing_tables_insurer_id ON pricing_tables (insurer_id);
CREATE INDEX idx_pricing_tables_product_code ON pricing_tables (product_code);
CREATE INDEX idx_pricing_tables_uploaded_by ON pricing_tables (uploaded_by);
CREATE INDEX idx_pricing_tables_age_range ON pricing_tables (age_min, age_max);

-- alerts
CREATE INDEX idx_alerts_broker_id ON alerts (broker_id);
CREATE INDEX idx_alerts_type ON alerts (type);
CREATE INDEX idx_alerts_unread ON alerts (broker_id, read) WHERE read = false;

-- ingestion_logs
CREATE INDEX idx_ingestion_logs_source ON ingestion_logs (source);
CREATE INDEX idx_ingestion_logs_status ON ingestion_logs (status);
CREATE INDEX idx_ingestion_logs_started_at ON ingestion_logs (started_at DESC);

-- audit_log
CREATE INDEX idx_audit_log_table_record ON audit_log (table_name, record_id);
CREATE INDEX idx_audit_log_changed_at ON audit_log (changed_at DESC);
CREATE INDEX idx_audit_log_changed_by ON audit_log (changed_by);

-- subscription_events
CREATE INDEX idx_subscription_events_broker_id ON subscription_events (broker_id);
CREATE INDEX idx_subscription_events_type ON subscription_events (event_type);
CREATE INDEX idx_subscription_events_created_at ON subscription_events (created_at DESC);

-- product_analytics_events
CREATE INDEX idx_product_analytics_events_created_at ON product_analytics_events (created_at DESC);
CREATE INDEX idx_product_analytics_events_name_created_at ON product_analytics_events (event_name, created_at DESC);
CREATE INDEX idx_product_analytics_events_broker_created_at ON product_analytics_events (broker_id, created_at DESC);
CREATE INDEX idx_product_analytics_events_auth_created_at ON product_analytics_events (auth_user_id, created_at DESC);

-- idempotency_keys
CREATE INDEX idx_idempotency_keys_expires_at ON idempotency_keys (expires_at);

-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all public tables
ALTER TABLE insurers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverages ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Helper: get current broker_id from auth context
CREATE OR REPLACE FUNCTION get_broker_id()
RETURNS uuid AS $$
  SELECT id FROM brokers WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---------------------------------------------------------------------------
-- RLS Policies: Public/read-only tables (insurers, products, coverages, documents)
-- ---------------------------------------------------------------------------

-- insurers: all authenticated users can read active insurers
CREATE POLICY "insurers_select_authenticated"
  ON insurers FOR SELECT TO authenticated
  USING (active = true);

-- products: all authenticated users can read active products
CREATE POLICY "products_select_authenticated"
  ON products FOR SELECT TO authenticated
  USING (active = true);

-- coverages: all authenticated users can read
CREATE POLICY "coverages_select_authenticated"
  ON coverages FOR SELECT TO authenticated
  USING (true);

-- documents: all authenticated users can read
CREATE POLICY "documents_select_authenticated"
  ON documents FOR SELECT TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- RLS Policies: brokers — own record only
-- ---------------------------------------------------------------------------

CREATE POLICY "brokers_select_own"
  ON brokers FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "brokers_update_own"
  ON brokers FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS Policies: broker_clients — broker sees only their own clients
-- ---------------------------------------------------------------------------

CREATE POLICY "broker_clients_select_own"
  ON broker_clients FOR SELECT TO authenticated
  USING (broker_id = get_broker_id());

CREATE POLICY "broker_clients_insert_own"
  ON broker_clients FOR INSERT TO authenticated
  WITH CHECK (broker_id = get_broker_id());

CREATE POLICY "broker_clients_update_own"
  ON broker_clients FOR UPDATE TO authenticated
  USING (broker_id = get_broker_id())
  WITH CHECK (broker_id = get_broker_id());

CREATE POLICY "broker_clients_delete_own"
  ON broker_clients FOR DELETE TO authenticated
  USING (broker_id = get_broker_id());

-- ---------------------------------------------------------------------------
-- RLS Policies: policies — broker sees only their own
-- ---------------------------------------------------------------------------

CREATE POLICY "policies_select_own"
  ON policies FOR SELECT TO authenticated
  USING (broker_id = get_broker_id());

CREATE POLICY "policies_insert_own"
  ON policies FOR INSERT TO authenticated
  WITH CHECK (broker_id = get_broker_id());

CREATE POLICY "policies_update_own"
  ON policies FOR UPDATE TO authenticated
  USING (broker_id = get_broker_id())
  WITH CHECK (broker_id = get_broker_id());

-- ---------------------------------------------------------------------------
-- RLS Policies: conversations — broker sees only their own
-- ---------------------------------------------------------------------------

CREATE POLICY "conversations_select_own"
  ON conversations FOR SELECT TO authenticated
  USING (broker_id = get_broker_id());

CREATE POLICY "conversations_insert_own"
  ON conversations FOR INSERT TO authenticated
  WITH CHECK (broker_id = get_broker_id());

-- ---------------------------------------------------------------------------
-- RLS Policies: claim_analyses — broker sees only their own
-- ---------------------------------------------------------------------------

CREATE POLICY "claim_analyses_select_own"
  ON claim_analyses FOR SELECT TO authenticated
  USING (broker_id = get_broker_id());

CREATE POLICY "claim_analyses_insert_own"
  ON claim_analyses FOR INSERT TO authenticated
  WITH CHECK (broker_id = get_broker_id());

-- ---------------------------------------------------------------------------
-- RLS Policies: simulations — broker sees only their own
-- ---------------------------------------------------------------------------

CREATE POLICY "simulations_select_own"
  ON simulations FOR SELECT TO authenticated
  USING (broker_id = get_broker_id());

CREATE POLICY "simulations_insert_own"
  ON simulations FOR INSERT TO authenticated
  WITH CHECK (broker_id = get_broker_id());

-- ---------------------------------------------------------------------------
-- RLS Policies: proposals — broker sees only their own
-- ---------------------------------------------------------------------------

CREATE POLICY "proposals_select_own"
  ON proposals FOR SELECT TO authenticated
  USING (broker_id = get_broker_id());

CREATE POLICY "proposals_insert_own"
  ON proposals FOR INSERT TO authenticated
  WITH CHECK (broker_id = get_broker_id());

CREATE POLICY "proposals_update_own"
  ON proposals FOR UPDATE TO authenticated
  USING (broker_id = get_broker_id())
  WITH CHECK (broker_id = get_broker_id());

-- ---------------------------------------------------------------------------
-- RLS Policies: pricing_tables — broker sees all, inserts own
-- ---------------------------------------------------------------------------

CREATE POLICY "pricing_tables_select_authenticated"
  ON pricing_tables FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "pricing_tables_insert_own"
  ON pricing_tables FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = get_broker_id());

-- ---------------------------------------------------------------------------
-- RLS Policies: alerts — broker sees own + global (null broker_id)
-- ---------------------------------------------------------------------------

CREATE POLICY "alerts_select_own_or_global"
  ON alerts FOR SELECT TO authenticated
  USING (broker_id IS NULL OR broker_id = get_broker_id());

CREATE POLICY "alerts_update_own"
  ON alerts FOR UPDATE TO authenticated
  USING (broker_id = get_broker_id())
  WITH CHECK (broker_id = get_broker_id());

-- ---------------------------------------------------------------------------
-- RLS Policies: ingestion_logs — read-only for authenticated (admin use)
-- ---------------------------------------------------------------------------

CREATE POLICY "ingestion_logs_select_authenticated"
  ON ingestion_logs FOR SELECT TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- RLS Policies: audit_log — no access from client, service role only
-- ---------------------------------------------------------------------------

CREATE POLICY "audit_log_deny_all"
  ON audit_log FOR SELECT TO authenticated
  USING (false);

-- ---------------------------------------------------------------------------
-- RLS Policies: subscription_events — broker sees own events
-- ---------------------------------------------------------------------------

CREATE POLICY "subscription_events_select_own"
  ON subscription_events FOR SELECT TO authenticated
  USING (broker_id = get_broker_id());

-- ---------------------------------------------------------------------------
-- RLS Policies: idempotency_keys — service role only (no client access)
-- ---------------------------------------------------------------------------

CREATE POLICY "idempotency_keys_deny_all"
  ON idempotency_keys FOR SELECT TO authenticated
  USING (false);

-- ============================================================================
-- 6. TRIGGERS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- set_updated_at triggers on ALL tables with updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_insurers_updated_at
  BEFORE UPDATE ON insurers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_coverages_updated_at
  BEFORE UPDATE ON coverages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_brokers_updated_at
  BEFORE UPDATE ON brokers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_broker_clients_updated_at
  BEFORE UPDATE ON broker_clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_policies_updated_at
  BEFORE UPDATE ON policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_claim_analyses_updated_at
  BEFORE UPDATE ON claim_analyses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_simulations_updated_at
  BEFORE UPDATE ON simulations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_proposals_updated_at
  BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pricing_tables_updated_at
  BEFORE UPDATE ON pricing_tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_alerts_updated_at
  BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_ingestion_logs_updated_at
  BEFORE UPDATE ON ingestion_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subscription_events_updated_at
  BEFORE UPDATE ON subscription_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trail triggers on critical tables
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_brokers_audit
  AFTER INSERT OR UPDATE OR DELETE ON brokers
  FOR EACH ROW EXECUTE FUNCTION audit_trail();

CREATE TRIGGER trg_policies_audit
  AFTER INSERT OR UPDATE OR DELETE ON policies
  FOR EACH ROW EXECUTE FUNCTION audit_trail();

CREATE TRIGGER trg_proposals_audit
  AFTER INSERT OR UPDATE OR DELETE ON proposals
  FOR EACH ROW EXECUTE FUNCTION audit_trail();

CREATE TRIGGER trg_subscription_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON subscription_events
  FOR EACH ROW EXECUTE FUNCTION audit_trail();

-- ---------------------------------------------------------------------------
-- State machine transition enforcement triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_policies_status_transition
  BEFORE UPDATE OF status ON policies
  FOR EACH ROW EXECUTE FUNCTION validate_policy_status_transition();

CREATE TRIGGER trg_proposals_status_transition
  BEFORE UPDATE OF status ON proposals
  FOR EACH ROW EXECUTE FUNCTION validate_proposal_status_transition();
