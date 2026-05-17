# SOLOMON — Phase 2 / Slice 3C — Promotion design (controlled)

_Generated 2026-05-17. Pure design document — no code change to the read path, no production activation, no schema change applied. Replaces the substring-proxy era of slices 3B.5–3B.7.10 + 3B.6.4 with a controlled plan for how to actually flip Prudential reads onto the shadow corpus._

**Predecessor chain (cumulative authorization):**
- PR #45 — Q16 surgical audit (proxy artifact identified).
- PR #46 — token fix (`dois anos`).
- PR #47 — `match_count` 10 → 20 falsified the cutoff hypothesis.
- PR #48 — Ragas CP+CR judge: in-scope conditions `dCP=+0.094 / dCR=+0.042`, Q16 CR tie at 0.500. STOP signal CLEAR.

**This slice (3C)** does NOT activate anything. It delivers the design + control plan so the next slice (3C activation) is a 1-flag flip with full observability, fast rollback, and zero ambiguity about which corpus served which query.

## 0. Hard constraints (CEO scope, verbatim)

> Não fazer: promoção real / `valid_until = NULL` / DELETE / cleanup v3 / Azos/MAG / Agentic RAG / PageIndex / embedder rerun / page-span 100 / alteração irreversível no banco.

Honored throughout. This document does NOT propose any of the above for slice 3C itself; some are explicitly deferred to later slices (e.g., v3 cleanup) and documented as such.

## 1. State of the world today (what we are designing on top of)

### 1.1 Read path is a single chokepoint

All production retrieval funnels through ONE file and effectively ONE line:

| Surface | File | Function |
|---|---|---|
| Oracle (chat + comparison) | `src/services/rag/answer.ts` | `ask()` → `semanticSearch*()` |
| Streaming oracle (dashboard) | `src/services/rag/stream.ts` | streams `ask()`-style results |
| Pre-sinistro | `src/services/rag/pre-sinistro.ts` | `semanticSearch*()` for context |
| Multi-insurer compare | `src/services/rag/compare.ts` | `semanticSearchAndRerank()` |
| Knowledge search API | `src/app/api/knowledge/search/route.ts` | `semanticSearch()` |
| Public search API | `src/app/api/search/route.ts` | `semanticSearch()` |
| Service barrel | `src/services/rag/index.ts` | re-exports |

Every one of those calls eventually lands in **`src/services/rag/search.ts:71`** — a single `supabase.rpc('match_documents', { … })`. The string literal `'match_documents'` appears ONCE on the read path. **That is our control point.**

### 1.2 Insurer routing already exists and is reliable

`answer.ts:817` `detectInsurers(question)` returns canonical insurer names from question text (regex patterns). `answer.ts:153` consumes it. It is the existing, battle-tested signal for "which insurer is this query about?".

Three buckets:
- `mentionedInsurers.length === 0` → global search (no insurer filter).
- `mentionedInsurers.length === 1` → insurer-targeted search (single-insurer filter).
- `mentionedInsurers.length >= 2` → multi-insurer fanout (Padrao C round-robin).

Only the **single-insurer case** is a candidate for shadow promotion. Global and multi-insurer queries require the full corpus (Prudential + Azos + MAG + Bradesco + ...); shadow has only Prudential `conditions_pdf` chunks. Activating shadow in those cases would lose all non-Prudential content.

### 1.3 Shadow corpus is inert and isolated

Shadow rows in `documents` carry:
- `valid_until = '1970-01-01T00:00:00Z'` (sentinel; production `match_documents` filters `valid_until IS NULL`).
- `metadata.shadow = true`.
- `metadata.hash_scheme = 'url-aware-v1'`.
- `embedding` populated (slice 3B.6.1).

The RPC `match_shadow_documents` (migration `20260516140000_match_shadow_documents.sql`) reads ONLY these rows. The production RPC `match_documents` cannot see them.

**This is why slice 3C only needs a read-path code change. No row mutation. No schema migration on `documents`. The corpora are already two disjoint sets of rows, addressed by two RPCs.**

### 1.4 Telemetry surfaces that already exist

| Surface | Purpose | State |
|---|---|---|
| Langfuse (`src/services/rag/llm.ts:46`) | LLM call traces, latency, model | Active in production |
| `eval_runs` table (agentes-hub `zwnlpumonvkrghoxnddd`) | Offline Ragas eval rows | Active; used by `run_eval.py` + `run_shadow_eval.py` |
| Vercel logs | App stdout | Active |
| Console logs in `ask()` etc. | Per-request retrieval tracing | Active |

**Gap:** no production-side retrieval-trace table. Every query's `corpus / chunks_returned / fallback_used` is currently inferable only from log greps. Slice 3C proposes a thin new table `retrieval_traces` (design only — schema below; migration NOT applied in this slice).

### 1.5 Existing flag pattern

The codebase uses plain env-var gates with code-default fallbacks (`process.env.X ?? "fallback"`). No formal feature-flag service (no LaunchDarkly, no Unleash, no GrowthBook). Examples:
- `COMPARE_MODEL = process.env.COMPARE_MODEL ?? "gemini-2.5-flash"` (`compare.ts:19`).
- `PRE_SINISTRO_MODEL = process.env.PRE_SINISTRO_MODEL ?? "gemini-2.5-flash"` (`pre-sinistro.ts:117`).

We match this pattern. No new infrastructure dependency.

## 2. Design overview (one diagram, one sentence)

```
question
   │
   ▼
detectInsurers(question)  ───►  ['Prudential']    (existing, unchanged)
   │
   ▼
chooseRetrievalCorpus(mentionedInsurers, options)   ◄── NEW HELPER
   │   (env whitelist + count check + DB routing table)
   │
   ├─► 'legacy'  ──►  semanticSearch(… match_documents …)        ← production default
   │
   └─► 'shadow'  ──►  semanticSearch(… match_shadow_documents …) ← only when whitelisted
                          │
                          ├─► success → return chunks (tagged corpus='shadow')
                          │
                          └─► error/empty → FALLBACK to legacy (logged + telemetry)
```

One sentence: **`search.ts:semanticSearchWithEmbedding` consults a small pure helper that returns `'legacy' | 'shadow'` based on insurer + whitelist; the helper defaults to `'legacy'` for every input; shadow can only be selected when explicitly enabled per insurer.**

## 3. The 10 design questions from the CEO

### 3.1 How the read path chooses legacy vs shadow

**New module:** `src/config/corpus-routing.ts`. Pure (no I/O). Three exports:

```ts
export type Corpus = 'legacy' | 'shadow'
export interface CorpusRoutingOptions {
  insurerNames: readonly string[]        // detectInsurers(question) output
  /** Override (testing / dry-run). null = use real config. */
  overrideCorpus?: Corpus | null
  /** Per-insurer DB routing table (slice 3C activation, NOT this slice). */
  dbRouting?: ReadonlyMap<string, Corpus>
}
export function chooseRetrievalCorpus(o: CorpusRoutingOptions): Corpus
```

Decision tree (in order):
1. If `overrideCorpus` is set → return it. (Test/preview hook.)
2. If `insurerNames.length !== 1` → return `'legacy'`. (Multi-insurer and global queries always use full corpus.)
3. Let `insurer = insurerNames[0]`.
4. If `dbRouting?.get(insurer) === 'shadow'` AND `getShadowAllowlist().has(insurer)` → return `'shadow'`. (Both env whitelist AND DB row must agree.)
5. Otherwise → `'legacy'`.

**`search.ts` becomes:**

```ts
const corpus = chooseRetrievalCorpus({ insurerNames, dbRouting })
const rpcName = corpus === 'shadow' ? 'match_shadow_documents' : 'match_documents'
const { data, error } = await (supabase.rpc as any)(rpcName, rpcArgs)
```

The string literal `'match_documents'` is replaced with a variable; that is the only material code change. Everything else (filter args, error handling, return shape) is unchanged.

### 3.2 Where the toggle lives — env + DB, AND-gated

**Two layers, both required to flip to shadow:**

**Layer A — env allowlist (build-time / deploy-time):**
- `SHADOW_CORPUS_ALLOWLIST="Prudential"` — comma-separated canonical names.
- Default empty string → nobody uses shadow.
- Set per Vercel environment (production / preview / dev). Production must be set explicitly.
- Behavior: if not in the list, `chooseRetrievalCorpus` returns `'legacy'` regardless of DB state.

**Layer B — DB routing table (runtime, hot-swappable):**
- New table `public.corpus_routing` (schema below; **NOT applied in slice 3C**, deferred to the activation slice):
```sql
CREATE TABLE public.corpus_routing (
  insurer_name text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('legacy', 'shadow')) DEFAULT 'legacy',
  mode_set_at timestamptz NOT NULL DEFAULT now(),
  mode_set_by text NOT NULL,           -- 'ceo' | 'oncall' | service identity
  notes text
);
```
- App loads this table at startup + on-demand refresh (5 min cache). Cache miss → safe default `'legacy'`.
- Hot rollback: `UPDATE corpus_routing SET mode='legacy' WHERE insurer_name='Prudential'` — no redeploy required.

**The AND-gate is the safety property:** Layer A is the build-time floor (someone has to have explicitly given this insurer permission to be considered). Layer B is the runtime selector. Both must agree on `'shadow'` for shadow to be selected.

### 3.3 How to limit initially to Prudential

Two hard restrictions that must hold simultaneously:
1. `SHADOW_CORPUS_ALLOWLIST` in the deployed env contains the literal `Prudential` and nothing else.
2. The `corpus_routing` table has at most one row with `mode='shadow'`, and that row is `insurer_name='Prudential'`.

A startup check (`assertSingleShadowInsurer()`) loads both, asserts the symmetric difference is empty, and **refuses to boot the server if any insurer in DB is not in env**. This is an explicit failure mode; it is loud (PM2 restart loop, Vercel deploy fails) rather than silent.

If the CEO later authorizes Azos shadow, both layers must be updated together (one PR with env change + DB row insert). Forgetting either side fails closed.

### 3.4 How to prevent accidental global activation

Five independent barriers, any one of which is sufficient to block:

1. **Empty-by-default env var.** `SHADOW_CORPUS_ALLOWLIST` defaults to `""`. With no env value, no insurer is shadow-eligible. The Vercel production env must be edited explicitly (audit trail in Vercel's UI history).
2. **Empty-by-default DB table.** Initial seed is no rows or all rows `mode='legacy'`. Activation requires a deliberate `UPDATE`.
3. **Single-insurer gate.** Multi-insurer and global queries cannot select shadow even if env+DB say yes (per § 3.1 step 2).
4. **`assertSingleShadowInsurer` boot check.** Mismatch between env allowlist and DB rows → process refuses to start.
5. **Code review on the activation slice.** That slice is small (one helper + one search.ts edit + one migration) and CEO-merge-gated. No "drift" path where shadow silently activates.

### 3.5 How to measure (five surfaces)

#### 3.5.1 Retrieval quality

- **Online:** every retrieval call writes to a new (deferred-to-activation) `retrieval_traces` table. Schema below.
- **Offline:** weekly cron rerun of `run_shadow_eval.py` against the live shadow + legacy corpora. Compares aggregate Ragas CP/CR over the 9 scoped Qs. Persists per-question rows to `eval_runs` (agentes-hub), tagged with `slice='3c-online-monitor'`.

```sql
CREATE TABLE public.retrieval_traces (
  id bigserial PRIMARY KEY,
  request_id text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  user_question_hash text,             -- sha256(question), NEVER the raw question (PII)
  insurer_name text,
  corpus text NOT NULL CHECK (corpus IN ('legacy', 'shadow')),
  mode text NOT NULL CHECK (mode IN ('serve', 'preview-only')),
  latency_ms integer NOT NULL,
  chunks_returned integer NOT NULL,
  fallback_used boolean NOT NULL DEFAULT false,
  fallback_reason text,                -- 'rpc_error' | 'empty_result' | 'flag_off' | null
  rerank_used boolean NOT NULL DEFAULT false,
  source text NOT NULL                 -- 'ask' | 'stream' | 'compare' | 'pre-sinistro' | 'api'
);
CREATE INDEX ON public.retrieval_traces (ts DESC);
CREATE INDEX ON public.retrieval_traces (insurer_name, corpus, ts DESC);
```

Inserts are best-effort (failure to write must not break the user request). Schema is **NOT applied in slice 3C**.

#### 3.5.2 Latency

- Per-request: `retrieval_traces.latency_ms` (just the RPC call duration).
- Aggregated: SQL view (`v_corpus_latency_p50_p95_p99` over 1h / 24h windows), grouped by `corpus`, `insurer_name`.
- Stop criterion (see § 3.7): p95 shadow latency must stay within +50% of p95 legacy latency over a 1h rolling window with N ≥ 100 each.

#### 3.5.3 Error rate

- `error_rate_shadow = count(corpus='shadow' AND fallback_used=true) / count(corpus='shadow')` over a 1h window.
- Stop criterion: > 5% sustained for 15 min, or > 20% in any 5-min window.

#### 3.5.4 Fallback usage

- Already captured by `fallback_used + fallback_reason`. Telemetry endpoint surfaces:
  - count of fallbacks by reason
  - distribution by hour
  - top insurer / source

#### 3.5.5 Answer confidence

- Existing `confidence` field in `AskResult` (the broker-facing confidence score) is tagged in Langfuse with `corpus`. Distribution-level comparison (legacy vs shadow) becomes a daily Langfuse dashboard.
- Stop criterion: shadow median confidence < legacy median confidence by more than 0.05 (absolute) sustained over 200 queries.

### 3.6 How to roll back — three levels, fastest first

| Level | What | Latency | Reversibility |
|---|---|---:|---|
| **L1 — DB flip** (RECOMMENDED FIRST) | `UPDATE corpus_routing SET mode='legacy' WHERE insurer_name='Prudential';` | **≤ 5 s** (DB write + next request reads fresh) | Trivial, audit-trailed in table |
| L2 — Env flip + redeploy | Vercel env edit `SHADOW_CORPUS_ALLOWLIST=""` + redeploy | ~60 s | Trivial, audit-trailed in Vercel UI |
| L3 — Code revert | `git revert <activation-commit>` + redeploy | ~3 min | Trivial, audit-trailed in git |

**Runbook:**

```bash
# L1 (DB flip — preferred)
psql "$SUPABASE_PRODUCT_DB_URL" -c \
  "UPDATE corpus_routing SET mode='legacy', mode_set_at=now(), mode_set_by='oncall' WHERE insurer_name='Prudential';"

# L2 (env flip — if L1 unavailable or fails)
vercel env rm SHADOW_CORPUS_ALLOWLIST production --yes
vercel env add SHADOW_CORPUS_ALLOWLIST production <<<""
vercel deploy --prod --force

# L3 (code revert — if structural bug in the code path itself)
git revert <activation-commit>
git push origin master   # auto-deploys via Vercel
```

L1 is the default rollback because it is fastest and most reversible. L2 is the fallback if the DB path itself is what is failing. L3 is for actual code bugs, not for "shadow looks bad".

### 3.7 How to audit which corpus answered each question

Three independent surfaces, designed so any one of them can answer the question "which corpus served request X?":

1. **`retrieval_traces` row** — primary, queryable by `request_id`.
2. **Langfuse trace attribute** — `trace.update({ tags: ['corpus:shadow'] })` in `ask()`. Browseable in Langfuse UI, exportable.
3. **API response header** in dev only — `X-Solomon-Corpus: shadow` (stripped in production responses; visible in `vercel dev` and preview deploys).

For broker complaints / debugging:
```sql
SELECT corpus, mode, fallback_used, fallback_reason, chunks_returned, latency_ms
FROM retrieval_traces
WHERE request_id = $1;
```

The Langfuse trace also gets `corpus`, `chunks_returned`, and `latency_ms` as user-properties so the existing analytics dashboards inherit the dimension for free.

### 3.8 How to avoid DELETE / v3 cleanup

The promotion path **does not touch a single shadow row.** Specifically:
- No `UPDATE documents SET valid_until = NULL`. The sentinel `'1970-01-01T00:00:00Z'` stays.
- No `DELETE` on shadow rows.
- No `DELETE` on v3 (pre-`url-aware-v1`) shadow rows. They remain in `documents` but are filtered out by `match_shadow_documents.metadata->>'hash_scheme' = 'url-aware-v1'` (already in the migration).
- v3 cleanup is **out of scope** for slice 3C. It is a future slice ("3D — shadow corpus janitor") and must come AFTER successful promotion + stabilization, never before.

**Why this matters:** the row-state isolation is what makes L3 rollback (code revert) sufficient. If we mutated rows during promotion, a code revert would leave the data in a hybrid state. Keeping promotion purely on the read side preserves the property that **all three rollback levels return the system to a clean pre-promotion state**.

### 3.9 How to keep shadow rows with traceability

Every shadow row already carries the lineage we need:
- `metadata.shadow = true`
- `metadata.hash_scheme = 'url-aware-v1'`
- `metadata.section`, `metadata.heading_path`, `metadata.page` (chunker output)
- `source_url`, `insurer_id`, `product_id`, `created_at`
- `valid_until = '1970-01-01T00:00:00Z'` (the inertness sentinel)

The activation slice adds NO new columns to `documents` and writes NO new metadata to existing rows. New audit lives in two side-tables:

| Table | Question it answers |
|---|---|
| `corpus_routing` (insurer, mode, mode_set_at, mode_set_by) | "Why was this query routed to shadow?" |
| `retrieval_traces` (request_id, corpus, fallback_used, …) | "Which corpus served this specific request?" |

Both tables are append-mostly. `corpus_routing` has at most one row per insurer + an `audit_log` view if we want history. `retrieval_traces` is a fact table; existing Supabase retention policy applies.

### 3.10 How to do dry-run before any real activation

**Three layers of dry-run, sequential:**

#### 3.10.1 Offline (already shipped, slice 3B.6.4)

`app/eval/ragas/run_shadow_eval.py` over the 9 scoped Qs against the live corpora. Stop-signal CLEAR means: legacy and shadow are comparable in aggregate, with shadow ≥ legacy in-scope. We have this signal now (PR #48).

#### 3.10.2 Preview-only mode (NEW, in the activation slice)

When `chooseRetrievalCorpus` is called for Prudential, the activation slice runs **both** retrievals in parallel:
- legacy chunks are returned to `ask()` and used to answer.
- shadow chunks are NOT returned. They are written to `retrieval_traces` with `mode='preview-only'`, plus Langfuse trace.

Production behavior is identical to today; we are just observing what shadow WOULD have returned for live traffic. Gate this with `SHADOW_PREVIEW_MODE=true`. CEO can run this for N days before flipping `corpus_routing.mode` to `'shadow'`.

This is the key safety feature of the activation slice: we get real production traffic into the shadow telemetry without ever serving a shadow answer.

#### 3.10.3 Per-broker canary (NEW, optional, in the activation slice)

If preview-only looks healthy, before flipping all of Prudential to shadow we can do a per-broker canary: a column `corpus_routing.canary_broker_ids uuid[]` (optional, NOT in v1 of the schema) limits `mode='shadow'` to a hand-picked list of brokers. Julio + 1–2 others first; observe; then drop the canary list to flip everyone on Prudential.

## 4. Stop criteria (when to abort activation, per CEO request)

The activation slice MUST stop and roll back to legacy if any of the following holds for sustained windows:

| Signal | Threshold | Window | Auto-action |
|---|---|---|---|
| Error rate (shadow fallback to legacy) | > 5% | 15 min | Alert + L1 rollback |
| Error rate (shadow fallback to legacy) | > 20% | 5 min | Auto L1 rollback |
| p95 latency shadow vs legacy | shadow > 1.5× legacy | 1 h, N ≥ 100 | Alert |
| Median confidence delta | shadow < legacy − 0.05 | 200 queries | Alert |
| Offline weekly Ragas | concept aggregate CR regresses by > 0.03 | 1 run | Alert + freeze |
| Any RPC raises | new error class never seen before | 1 occurrence | Page on-call |

"Alert" = Slack/page to on-call. "Auto L1 rollback" = supabase function/edge-job flips `corpus_routing` on threshold breach. Auto-rollback design is OPTIONAL for slice 3C activation — the manual rollback is the floor.

## 5. Activation criteria (when to flip, per CEO request)

Forward path:
1. **Slice 3C** (this PR): merge design doc. No code change yet.
2. **Slice 3C-a — scaffold** (next): land `src/config/corpus-routing.ts` + types + unit tests. Wire it into `search.ts` but with **`SHADOW_CORPUS_ALLOWLIST=""`** and **no `corpus_routing` table yet** → behavior identical to today. Two-layer assertion that the system boots in legacy-only mode.
3. **Slice 3C-b — telemetry**: add migration for `retrieval_traces` + `corpus_routing`; wire trace writes; verify `retrieval_traces` populates with `corpus='legacy'` for every request. Still zero shadow traffic.
4. **Slice 3C-c — preview-only**: enable `SHADOW_PREVIEW_MODE=true` for Prudential traffic. Both retrievals run; legacy serves. Observe for **≥ 7 days** OR ≥ 5000 Prudential queries (whichever first).
5. **Slice 3C-d — canary**: if preview-only telemetry stays clean (no error spike, p95 latency within bound, shadow chunks-returned distribution matches expectations), flip `corpus_routing.mode='shadow'` for Prudential AND keep canary list with **Julio only**. Observe ≥ 48 h.
6. **Slice 3C-e — full Prudential**: drop canary; all Prudential single-insurer queries go to shadow. Observe ≥ 7 days.
7. **Slice 3D** (separate milestone): v3 row janitor; Azos/MAG shadow ingestion (re-uses the slice-3B chunker); per-insurer activation reuses this design.

Each step has a green/yellow/red checklist tied to the telemetry surfaces in § 3.5.

## 6. What this PR ships vs what it defers

**Ships now (slice 3C):**
- This design doc.
- Nothing else.

**Deferred to slice 3C-a (the scaffold slice, next PR):**
- `src/config/corpus-routing.ts` — pure helper, exported, defaults to `'legacy'`.
- Unit tests for `chooseRetrievalCorpus`.
- One-line edit to `search.ts:71` (replace `'match_documents'` literal with `rpcName` variable).
- No env vars set in production yet. No DB migration applied.

**Deferred to slice 3C-b (telemetry):**
- Migrations: `retrieval_traces` + `corpus_routing`.
- Best-effort insert in `search.ts`.
- Langfuse trace tag.

**Deferred to slice 3C-c+:**
- Preview-only mode, canary, full flip.

This sequence is **safe-by-construction**: every intermediate state has shadow returning zero traffic in production. Only the final two steps actually serve shadow chunks to brokers, and both are reversible at L1 (DB flip) in seconds.

## 7. Open questions / decisions deferred

- **Auto-rollback policy.** Should the threshold breaches in § 4 trigger automatic `corpus_routing.mode='legacy'` writes (via Supabase edge function), or only alerts? CEO to decide before slice 3C-d.
- **`retrieval_traces` retention.** Production traffic on SOLOMON is currently low (manual broker queries); table will grow slowly. Default = keep forever, revisit when row count > 1M.
- **PII in `user_question_hash`.** Hash-only is the v1 default to be safe. If CEO wants raw questions for debugging, gate behind a separate column with row-level access policy.
- **Multi-corpus rerank.** Cohere rerank currently sees only one corpus's candidates. Future hybrid retrieval (slice 3D+) might fetch from both and rerank the union — out of scope for 3C.

## 8. Guardrails honored (verbatim, per CEO scope)

| Guardrail | How honored |
|---|---|
| No promoção real | This PR ships docs only; activation deferred to 3C-c/d/e |
| No `valid_until = NULL` | Promotion via read code, never via row mutation |
| No DELETE | Shadow rows + v3 rows untouched |
| No cleanup v3 | Filtered by `hash_scheme='url-aware-v1'` in RPC; cleanup deferred to slice 3D |
| No Azos / MAG | Allowlist forbids non-Prudential insurers |
| No Agentic RAG / PageIndex | Not in scope of any 3C step |
| No embedder rerun | Shadow embeddings already populated (slice 3B.6.1) |
| No page-span 100 | Not in scope |
| No alteração irreversível no banco | Every proposed migration is `CREATE TABLE` + `DROP TABLE` reversible; no destructive ALTER on `documents` |
| Prudential-only | Allowlist + DB row + single-insurer gate are all defaulted to deny |

## 9. Artifacts

- This document: `docs/phase-2-pr3c-promotion-design.md`.
- Predecessor evidence: `docs/phase-2-pr3b6.4-ragas-judge.md` + `docs/audit-runs/phase-2-pr3b6.4-20260517T180706Z/*`.
- Read-path inspection: `src/services/rag/search.ts`, `src/services/rag/answer.ts:153`, `src/config/constants.ts`, `app/supabase/migrations/20260516140000_match_shadow_documents.sql`.

## 10. Recommendation

Approve the design and authorize **slice 3C-a (scaffold)** as the next concrete PR. The scaffold is a ~50-line code change with no production effect: it lands the helper, the search.ts switch-on-variable, and the boot-time assertion that the allowlist is empty by default. Telemetry and preview-only follow as separate, individually-revertible PRs.
