-- Migration: expandir rate_unit para suportar MAG
-- Motivo: MAG publica taxas em unidades diferentes de "por R$1.000 de CS":
--  - Pensao por Morte / Renda por Invalidez: por R$1.000 da RENDA mensal
--  - DIH / UTI: por R$100 de DIARIA contratada (mensal)
-- Sem essas unidades, o CHECK original bloqueia insert e o consumidor nao
-- consegue distinguir "por R$1000 de capital" de "por R$1000 de renda".

ALTER TABLE insurer_rate_tables
  DROP CONSTRAINT IF EXISTS insurer_rate_tables_rate_unit_check;

ALTER TABLE insurer_rate_tables
  ADD CONSTRAINT insurer_rate_tables_rate_unit_check
  CHECK (rate_unit IN (
    'per_1000_annual',
    'per_1000_monthly',
    'per_1000_renda_monthly',
    'per_100_diaria_monthly',
    'flat_brl',
    'factor'
  ));
