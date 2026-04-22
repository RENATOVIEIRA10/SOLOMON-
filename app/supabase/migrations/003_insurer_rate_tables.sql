-- Migration: insurer_rate_tables
-- Armazena TAXAS publicadas em tabelas de premios de seguradoras.
-- Diferente de pricing_tables (broker-uploaded com premio ja computado): aqui
-- guardamos a TAXA por R$1.000 de capital segurado, quebrada por idade/sexo/
-- cobertura/periodo. O RAG usa isto para responder consultas de premio sem
-- alucinar.
--
-- Fonte inicial: Prudential Cod1645 V15 MAR26 (Portfolios F, G, Protecao em Vida).

CREATE TABLE IF NOT EXISTS insurer_rate_tables (
  id              bigserial PRIMARY KEY,
  insurer_id      uuid NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
  product_name    text NOT NULL,
  product_code    text NOT NULL,
  portfolio       text,
  coverage_type   text NOT NULL DEFAULT 'BASICA',
  gender          char(1) NOT NULL CHECK (gender IN ('M','F')),
  age             int NOT NULL CHECK (age BETWEEN 0 AND 120),
  period          text,
  rate            numeric NOT NULL CHECK (rate >= 0),
  rate_unit       text NOT NULL DEFAULT 'per_1000_annual'
                  CHECK (rate_unit IN ('per_1000_annual','per_1000_monthly','flat_brl','factor')),
  source_doc_name text NOT NULL,
  source_page     int,
  version_label   text,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (insurer_id, product_code, coverage_type, gender, age, period)
);

COMMENT ON TABLE insurer_rate_tables IS
  'Taxas publicadas em tabelas de premios de seguradoras (per R$1.000 de capital segurado por default). Fonte: tabelas tecnicas oficiais anexadas a condicoes gerais.';

CREATE INDEX IF NOT EXISTS insurer_rate_tables_lookup_idx
  ON insurer_rate_tables (insurer_id, product_code, gender, age);

CREATE INDEX IF NOT EXISTS insurer_rate_tables_product_name_idx
  ON insurer_rate_tables USING gin (to_tsvector('portuguese', product_name));
