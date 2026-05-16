# Phase 2 PR 3B slice 3B.5 — shadow-indexer batch report (live-write)

Generated: 2026-05-16T15:16:04.148Z

## Scope

- Batch mode. Prudential-only auto-discovery from Supabase.
- Per-doc inertness contract identical to single-URL mode.
- No embeddings. No DELETE. No read-path change. No product mutation.

## Inputs

- mode: `live-write`
- insurer: Prudential do Brasil (`dac17baa-c623-4023-9184-3ed2049a6237`)
- catalog size: 12
- min-chunks filter: 5
- limit: (none)
- resume: no
- page span per doc: `1-50`
- Azure DI endpoint: https://***.cognitiveservices.azure.com

## Preflights

| ok | check | detail |
|---|---|---|
| yes | documents.source_type CHECK includes conditions_pdf | supabase/migrations/20260422180000_baseline_snapshot.sql defines documents_source_type_check with conditions_pdf |
| yes | documents UNIQUE (content_hash, chunk_index) constraint | supabase/migrations/20260422180000_baseline_snapshot.sql defines documents_content_hash_chunk_index_key |
| yes | match_documents filters valid_until IS NULL (read path inert) | supabase/migrations/20260423180000_match_documents_exclude_rag_flagged.sql contains "valid_until IS NULL" |
| yes | answer.ts active-insurer probe filters valid_until null | src/services/rag/answer.ts calls .is('valid_until', null) — shadow rows skipped |

## Manifest

Discovered 22 Prudential URL(s) with active `conditions_pdf` chunks >= 5.

## Per-doc results

| # | source_url | legacy chunks | pages | chunks | accepted_current_run | quarantined | product | v4_sentinel_rows_for_url | extra_inert | leak | active legacy | status |
|---:|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---|
| 1 | `…m/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-e-saude.pdf` | 248 | 50 | 86 | 77 | 9 | _unresolved (fuzzy_below_threshold)_ | 80 | 3 | 0 | 248 | ORPHAN_SUPERSET |
| 2 | `…m/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira.pdf` | 241 | 50 | 83 | 72 | 11 | VIDA INTEIRA | 73 | 1 | 0 | 241 | ORPHAN_SUPERSET |
| 3 | `…ondicoes-gerais/vida-individual/condicoes-gerais-vida-inteira-modificado-30.pdf` | 232 | 50 | 85 | 71 | 14 | VIDA INTEIRA | 73 | 2 | 0 | 232 | ORPHAN_SUPERSET |
| 4 | `…dential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira-mais.pdf` | 231 | 50 | 89 | 79 | 10 | VIDA INTEIRA MAIS | 82 | 3 | 0 | 231 | ORPHAN_SUPERSET |
| 5 | `…dential/condicoes-gerais/vida-individual/condicoes-gerais-seguro-temporario.pdf` | 224 | 50 | 87 | 73 | 14 | TEMPORÁRIO | 75 | 2 | 0 | 224 | ORPHAN_SUPERSET |
| 6 | `…coes-gerais/vida-individual/condicoes-gerais-seguro-temporario-preferencial.pdf` | 220 | 50 | 86 | 74 | 12 | TEMPORÁRIO PREFERENCIAL | 76 | 2 | 0 | 220 | ORPHAN_SUPERSET |
| 7 | `…icoes-gerais/vida-individual/condicoes-gerais-vida-inteira-idades-especiais.pdf` | 218 | 50 | 90 | 74 | 16 | VIDA INTEIRA | 76 | 2 | 0 | 218 | ORPHAN_SUPERSET |
| 8 | `…icoes-gerais/vida-individual/condicoes-gerais-seguro-temporario-decrescente.pdf` | 213 | 50 | 84 | 70 | 14 | TEMPORÁRIO DECRESCENTE | 72 | 2 | 0 | 213 | ORPHAN_SUPERSET |
| 9 | `…prudential/condicoes-gerais/vida-individual/condicoes-gerais-renda-familiar.pdf` | 203 | 50 | 89 | 75 | 14 | RENDA FAMILIAR | 77 | 2 | 0 | 203 | ORPHAN_SUPERSET |
| 10 | `…da-empresarial/condicoes-gerais-seguro-vida-em-grupo-corporate-ate-30-09-18.pdf` | 141 | 50 | 144 | 102 | 42 | VG CORPORATE E VG EXPRESS | 103 | 1 | 0 | 141 | ORPHAN_SUPERSET |
| 11 | `…presarial/condicoes-gerais-seguro-viagem-corporativo-nacional-internacional.pdf` | 107 | 50 | 133 | 89 | 44 | VIAGEM | 91 | 2 | 0 | 107 | ORPHAN_SUPERSET |
| 12 | `…rial/Condi%C3%A7%C3%B5es%20Gerais%20e%20Especiais%20Capital%20Global_Dez-25.pdf` | 104 | 50 | 153 | 106 | 47 | PRUDENTIAL CAPITAL GLOBAL | 107 | 1 | 0 | 104 | ORPHAN_SUPERSET |
| 13 | `…is%20Seguro%20Prestamista%20Coletivo%20Capital%20Segurado%20Vinculado_Dez25.pdf` | 103 | 50 | 152 | 119 | 33 | _unresolved (fuzzy_below_threshold)_ | 122 | 3 | 0 | 103 | ORPHAN_SUPERSET |
| 14 | `…gerais/vida-empresarial/condicoes-gerais-e-especiais-capital-global_11-2024.pdf` | 98 | 50 | 142 | 103 | 39 | PRUDENTIAL CAPITAL GLOBAL | 103 | 0 | 0 | 98 | OVERWRITE |
| 15 | `…gerais/vida-empresarial/condicoes-gerais-capital-global-a-partir-02-02-2024.pdf` | 98 | 50 | 144 | 105 | 39 | PRUDENTIAL CAPITAL GLOBAL | 106 | 1 | 0 | 98 | ORPHAN_SUPERSET |
| 16 | `…vida-empresarial/condicoes-gerais-seguro-vida-em-grupo-express-ate-30-09-18.pdf` | 97 | 50 | 136 | 106 | 30 | _unresolved (fuzzy_below_threshold)_ | 107 | 1 | 0 | 97 | ORPHAN_SUPERSET |
| 17 | `…ida/minha-primeira-protecao/prudential-protecao-em-vida-doencas-graves-plus.pdf` | 94 | 50 | 89 | 72 | 17 | _unresolved (fuzzy_below_threshold)_ | 73 | 1 | 0 | 94 | ORPHAN_SUPERSET |
| 18 | `…gerais/vida-empresarial/condicoes-gerais-seguro-capital-global-ate-31-03-23.pdf` | 90 | 50 | 150 | 110 | 40 | PRUDENTIAL CAPITAL GLOBAL | 112 | 2 | 0 | 90 | ORPHAN_SUPERSET |
| 19 | `…ial/condicoes-gerais-seguro-prestamista-coletivo-capital-segurado-vinculado.pdf` | 77 | 50 | 148 | 112 | 36 | _unresolved (fuzzy_below_threshold)_ | 113 | 1 | 0 | 77 | ORPHAN_SUPERSET |
| 20 | `…ial/Condi%C3%A7%C3%B5es%20Gerais%20Acidentes%20Pessoais%20Passageiro_Dez-25.pdf` | 71 | 50 | 158 | 98 | 60 | ACIDENTES PESSOAIS PASSAGEIROS | 99 | 1 | 0 | 71 | ORPHAN_SUPERSET |
| 21 | `…ential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira-unico.pdf` | 51 | 50 | 81 | 71 | 10 | VIDA INTEIRA | 72 | 1 | 0 | 51 | ORPHAN_SUPERSET |
| 22 | `…esarial/condicoes-gerais-seguro-acidentes-pessoais-passageiros-ate-30-09-18.pdf` | 39 | 30 | 75 | 60 | 15 | ACIDENTES PESSOAIS PASSAGEIROS | 61 | 1 | 0 | 39 | ORPHAN_SUPERSET |

### ORPHAN_SUPERSET notes

> Benign: this run's accepted rows are in DB; DB also has extra inert v4 rows from
> a prior run at a different `--max-pages`. The chunker's `chunk_index` depends on
> the Azure DI layout, which changes with page span — so the same text can land at
> different chunk_indices across runs, producing distinct `(content_hash,
> chunk_index)` tuples that all coexist. All rows are at sentinel `valid_until`
> and never reach the read path. Not a stop signal. `metadata.page_span` on each
> row tells you which run produced it.

- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-e-saude.pdf` -- accepted=77, v4_sentinel_rows_for_url=80, extra_inert=3
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira.pdf` -- accepted=72, v4_sentinel_rows_for_url=73, extra_inert=1
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira-modificado-30.pdf` -- accepted=71, v4_sentinel_rows_for_url=73, extra_inert=2
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira-mais.pdf` -- accepted=79, v4_sentinel_rows_for_url=82, extra_inert=3
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-seguro-temporario.pdf` -- accepted=73, v4_sentinel_rows_for_url=75, extra_inert=2
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-seguro-temporario-preferencial.pdf` -- accepted=74, v4_sentinel_rows_for_url=76, extra_inert=2
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira-idades-especiais.pdf` -- accepted=74, v4_sentinel_rows_for_url=76, extra_inert=2
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-seguro-temporario-decrescente.pdf` -- accepted=70, v4_sentinel_rows_for_url=72, extra_inert=2
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-renda-familiar.pdf` -- accepted=75, v4_sentinel_rows_for_url=77, extra_inert=2
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/condicoes-gerais-seguro-vida-em-grupo-corporate-ate-30-09-18.pdf` -- accepted=102, v4_sentinel_rows_for_url=103, extra_inert=1
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/condicoes-gerais-seguro-viagem-corporativo-nacional-internacional.pdf` -- accepted=89, v4_sentinel_rows_for_url=91, extra_inert=2
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/Condi%C3%A7%C3%B5es%20Gerais%20e%20Especiais%20Capital%20Global_Dez-25.pdf` -- accepted=106, v4_sentinel_rows_for_url=107, extra_inert=1
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/Condi%C3%A7%C3%B5es%20Gerais%20Seguro%20Prestamista%20Coletivo%20Capital%20Segurado%20Vinculado_Dez25.pdf` -- accepted=119, v4_sentinel_rows_for_url=122, extra_inert=3
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/condicoes-gerais-capital-global-a-partir-02-02-2024.pdf` -- accepted=105, v4_sentinel_rows_for_url=106, extra_inert=1
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/condicoes-gerais-seguro-vida-em-grupo-express-ate-30-09-18.pdf` -- accepted=106, v4_sentinel_rows_for_url=107, extra_inert=1
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/protecao-em-vida/minha-primeira-protecao/prudential-protecao-em-vida-doencas-graves-plus.pdf` -- accepted=72, v4_sentinel_rows_for_url=73, extra_inert=1
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/condicoes-gerais-seguro-capital-global-ate-31-03-23.pdf` -- accepted=110, v4_sentinel_rows_for_url=112, extra_inert=2
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/condicoes-gerais-seguro-prestamista-coletivo-capital-segurado-vinculado.pdf` -- accepted=112, v4_sentinel_rows_for_url=113, extra_inert=1
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/Condi%C3%A7%C3%B5es%20Gerais%20Acidentes%20Pessoais%20Passageiro_Dez-25.pdf` -- accepted=98, v4_sentinel_rows_for_url=99, extra_inert=1
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-individual/condicoes-gerais-vida-inteira-unico.pdf` -- accepted=71, v4_sentinel_rows_for_url=72, extra_inert=1
- `https://www.prudential.com.br/content/dam/prudential/condicoes-gerais/vida-empresarial/condicoes-gerais-seguro-acidentes-pessoais-passageiros-ate-30-09-18.pdf` -- accepted=60, v4_sentinel_rows_for_url=61, extra_inert=1

## Aggregate

| metric | value |
|---|---:|
| docs planned | 22 |
| docs skipped (resume) | 0 |
| docs ran | 22 |
| docs FRESH (pre=0) | 0 |
| docs IDEMPOTENT_HIT | 0 |
| docs OVERWRITE | 1 |
| docs ORPHAN_SUPERSET (benign) | 21 |
| docs AZURE_ERROR | 0 |
| docs WRITE_ERROR | 0 |
| docs unresolved | 5 |
| total pages (Azure) | 1080 |
| total chunks | 2484 |
| total accepted | 1918 |
| total quarantined | 566 |
| total v4 shadow rows upserted | 1953 |
| total extra inert shadow (benign) | 35 |
| **total shadow leaks** | **0** |
| estimated Azure cost (USD, @ $0.015/page) | $16.20 |

## Final read-path probe (`match_documents` RPC)

- threshold=0, top_k=50, rows returned=40
- rows with `metadata.shadow=true`: **0** (MUST be 0)
- rows with non-null `valid_until`: **0** (MUST be 0)

## Guardrails honored

- Prudential-only insurer guard (Azos/MAG refused at module level).
- Per-doc 4 static preflights, evaluated once at batch start.
- Per-doc cost cap (`--max-pages`); >50 requires `--allow-cost-blast`.
- `assertRowsAreInert` runs before every per-doc upsert.
- Idempotent: upsert on `(content_hash, chunk_index)`. `--resume` short-circuits already-shadowed URLs.
- No DELETE. No embeddings. No read-path change. No product mutation.