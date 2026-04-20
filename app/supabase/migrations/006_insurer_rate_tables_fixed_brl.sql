-- 006_insurer_rate_tables_fixed_brl.sql
-- Expande rate_unit CHECK com 'fixed_brl_monthly' para suportar matrizes DITA/DIT
-- (premio mensal fixo em BRL para combinacao renda_mensal x capital_segurado x idade x sexo x franquia).
-- Essas tabelas listam o premio ja calculado, nao uma taxa por R$1.000.
-- Campo period carrega (franquia, renda, capital) codificados como "F{7|10}_R{renda}_C{capital}".

ALTER TABLE public.insurer_rate_tables
  DROP CONSTRAINT IF EXISTS insurer_rate_tables_rate_unit_check;

ALTER TABLE public.insurer_rate_tables
  ADD CONSTRAINT insurer_rate_tables_rate_unit_check
  CHECK (rate_unit = ANY (ARRAY[
    'per_1000_annual'::text,
    'per_1000_monthly'::text,
    'per_1000_renda_monthly'::text,
    'per_100_diaria_monthly'::text,
    'fixed_brl_monthly'::text,
    'flat_brl'::text,
    'factor'::text
  ]));
