-- Migration: insurer_rate_tables UNIQUE refinement
-- Motivo: o UNIQUE original (insurer_id, product_code, coverage_type, gender, age, period)
-- colide quando o mesmo product_code aparece em variantes de product_name (BASICO vs PLUS)
-- ou em paginas diferentes com brackets de capital distintos. O parser carrega linhas que
-- sao legitimas duplicatas por chave velha mas distintas na fonte (source_page).
--
-- Ajuste: incluir product_name e source_page no UNIQUE para permitir coexistir linhas
-- legitimamente diferentes vindas de paginas/variantes distintas do mesmo PDF.

ALTER TABLE insurer_rate_tables
  DROP CONSTRAINT IF EXISTS insurer_rate_tables_insurer_id_product_code_coverage_type_g_key;

ALTER TABLE insurer_rate_tables
  DROP CONSTRAINT IF EXISTS insurer_rate_tables_unique;

ALTER TABLE insurer_rate_tables
  ADD CONSTRAINT insurer_rate_tables_unique
  UNIQUE (insurer_id, product_name, product_code, coverage_type, gender, age, period, source_page);
