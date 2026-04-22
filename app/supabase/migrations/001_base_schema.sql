-- Migration: base schema
-- Cria o schema fundamental usado por todo o SOLOMON.
-- Deve ser aplicado ANTES das migrations 002-006.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Insurers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS insurers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE,
  logo_url    text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE insurers IS 'Seguradoras indexadas no SOLOMON.';

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id        uuid NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
  name              text NOT NULL,
  susep_process     text,
  modality          text,
  product_code      text,
  coverage_summary  text,
  terms_url         text,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE products IS 'Produtos de seguro de vida vinculados a uma seguradora.';

CREATE INDEX IF NOT EXISTS products_insurer_idx ON products (insurer_id);
CREATE INDEX IF NOT EXISTS products_active_idx   ON products (active);

-- ---------------------------------------------------------------------------
-- Documents (chunks RAG)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content       text NOT NULL,
  embedding     vector(1536),
  metadata      jsonb NOT NULL DEFAULT '{}',
  source_url    text,
  source_type   text,
  product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  insurer_id    uuid REFERENCES insurers(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE documents IS 'Chunks de documentos PDF indexados via pgvector.';

CREATE INDEX IF NOT EXISTS documents_embedding_idx ON documents USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS documents_insurer_idx   ON documents (insurer_id);
CREATE INDEX IF NOT EXISTS documents_product_idx   ON documents (product_id);
CREATE INDEX IF NOT EXISTS documents_source_type_idx ON documents (source_type);

-- ---------------------------------------------------------------------------
-- Brokers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS brokers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id      uuid UNIQUE,
  name              text NOT NULL,
  phone             text,
  email             text,
  cpf               text,
  creci             text,
  susep_number      text,
  plan              text NOT NULL DEFAULT 'trial',
  queries_today     int NOT NULL DEFAULT 0,
  queries_reset_at  timestamptz,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE brokers IS 'Corretores cadastrados no SOLOMON (via WhatsApp ou dashboard).';

CREATE INDEX IF NOT EXISTS brokers_phone_idx ON brokers (phone);
CREATE INDEX IF NOT EXISTS brokers_auth_user_idx ON brokers (auth_user_id);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id     uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  channel       text NOT NULL DEFAULT 'api',
  message       text NOT NULL,
  response      text NOT NULL,
  model         text,
  tokens_used   int,
  latency_ms    int,
  sources       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE conversations IS 'Log de conversas entre corretor e SOLOMON.';

CREATE INDEX IF NOT EXISTS conversations_broker_idx ON conversations (broker_id);
CREATE INDEX IF NOT EXISTS conversations_created_at_idx ON conversations (created_at DESC);

-- ---------------------------------------------------------------------------
-- Conversation Feedback
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversation_feedback (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  broker_id         uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  rating            int CHECK (rating BETWEEN 1 AND 5),
  flagged_issue     text,
  comment           text,
  channel           text NOT NULL DEFAULT 'api',
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE conversation_feedback IS 'Feedback (nota 1-5) vinculado a uma conversa.';

CREATE INDEX IF NOT EXISTS conversation_feedback_broker_idx ON conversation_feedback (broker_id);
CREATE INDEX IF NOT EXISTS conversation_feedback_conv_idx   ON conversation_feedback (conversation_id);

-- ---------------------------------------------------------------------------
-- Broker Clients
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS broker_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id     uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  name          text NOT NULL,
  cpf           text,
  phone         text,
  email         text,
  birth_date    date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE broker_clients IS 'Clientes dos corretores (CRM interno).';

CREATE INDEX IF NOT EXISTS broker_clients_broker_idx ON broker_clients (broker_id);

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id     uuid REFERENCES brokers(id) ON DELETE CASCADE,
  type          text NOT NULL,
  title         text NOT NULL,
  message       text NOT NULL,
  source_url    text,
  read          boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE alerts IS 'Alertas globais (broker_id null) ou pessoais do corretor.';

CREATE INDEX IF NOT EXISTS alerts_broker_read_idx ON alerts (broker_id, read);
CREATE INDEX IF NOT EXISTS alerts_created_at_idx  ON alerts (created_at DESC);

-- ---------------------------------------------------------------------------
-- Idempotency Keys (webhook dedup)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id            bigserial PRIMARY KEY,
  key           text NOT NULL UNIQUE,
  endpoint      text NOT NULL,
  response      jsonb,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE idempotency_keys IS 'Previne re-processamento de webhooks duplicados (Kapso/Meta).';

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- RPC: search_products (fallback structured search)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_products(
  search_query text,
  max_results int DEFAULT 10
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  insurer_id uuid,
  insurer_name text,
  modality text,
  susep_process text,
  product_code text,
  coverage_summary text,
  terms_url text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.insurer_id,
    i.name AS insurer_name,
    p.modality,
    p.susep_process,
    p.product_code,
    p.coverage_summary,
    p.terms_url
  FROM products p
  JOIN insurers i ON i.id = p.insurer_id
  WHERE
    p.name ILIKE '%' || search_query || '%'
    OR p.modality ILIKE '%' || search_query || '%'
    OR p.susep_process ILIKE '%' || search_query || '%'
    OR p.product_code ILIKE '%' || search_query || '%'
    OR p.coverage_summary ILIKE '%' || search_query || '%'
    OR i.name ILIKE '%' || search_query || '%'
  ORDER BY
    CASE WHEN p.name ILIKE search_query THEN 0 ELSE 1 END,
    p.name
  LIMIT max_results;
$$;
