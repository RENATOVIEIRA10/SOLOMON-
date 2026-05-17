# SOLOMON — Phase 2 / Slice 3C-c.1 — Preview-window runbook

_Generated 2026-05-17. Tooling-only deliverable: activation script is CEO-operated; the report tool is ready to query `retrieval_traces` as soon as preview traffic starts flowing._

**Predecessor:** PR #52 (slice 3C-c — preview-only mode shipped, default env empty).

## 1. What this slice ships

| File | Purpose |
|---|---|
| `app/scripts/phase2/preview-window-report.py` | Read-only report tool. Queries `retrieval_traces` + `corpus_routing`, emits a Markdown report with every signal the CEO needs to decide on slice 3C-d. |
| `app/package.json` | `phase2:preview-window-report` npm script. |
| `docs/phase-2-pr3c-c1-preview-runbook.md` | This document (activation steps + decision criteria + sample commands). |

**Nothing else.** No code change to the read path. No migration. No flag flipped.

## 2. Activation (CEO-operated)

The preview-only mode is gated by a single env var: `SHADOW_PREVIEW_INSURERS`. PR #52 wired the helper end-to-end with the default behaviour being **no preview**. To start observing shadow alongside legacy for Prudential single-insurer queries:

```bash
# Production
vercel env add SHADOW_PREVIEW_INSURERS production <<<"Prudential"

# Trigger a fresh deploy so the new env reaches running pods
vercel deploy --prod --force
```

Optional: set the same var on Vercel Preview environment for staging-style verification before prod.

**Safety reminders (verbatim from the slice-3C-c brief):**
- This is **NOT** promotion. The user-facing response continues to come from legacy.
- The shadow corpus runs in parallel, traced with `mode='preview-only'`, and is discarded.
- `corpus_routing.mode` remains `'legacy'` for Prudential. `SHADOW_CORPUS_ALLOWLIST` stays empty.
- Both kill-switches still apply:
  - Layer A: remove `SHADOW_PREVIEW_INSURERS` from Vercel env and redeploy (~60 s).
  - Layer B (faster): nothing to do — the preview write is fire-and-forget; legacy unaffected even if shadow RPC errors.

## 3. Observation window

CEO authorized either threshold:
- **≥ 5000** Prudential single-insurer queries with paired (legacy serve + shadow preview-only) traces, OR
- **≥ 7 days** of observation with at least **100** paired traces (zero-floor guard in the report tool to prevent vacuous PROCEED verdicts).

The script enforces both branches: see § 5.

## 4. Running the report

The script reads `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the environment. On the VPS this is satisfied by `app/.env.local`.

```bash
ssh root@104.131.187.118
cd /root/solomon/repo/app/eval/ragas && source .venv/bin/activate
set -a && source /root/solomon/repo/app/.env.local && set +a

# Default: last 7 days, Prudential, stdout
python /root/solomon/repo/app/scripts/phase2/preview-window-report.py

# Wider window, save to file
python /root/solomon/repo/app/scripts/phase2/preview-window-report.py \
  --days 14 \
  --out /tmp/preview-report-$(date -u +%Y%m%d).md

# Different insurer (future slices may add Azos/MAG to the preview list)
python /root/solomon/repo/app/scripts/phase2/preview-window-report.py --insurer Prudential
```

The script is **read-only**: it issues `SELECT` against `retrieval_traces` and `corpus_routing` via PostgREST. No `INSERT`, no `UPDATE`, no `DELETE` anywhere.

## 5. Verdict logic (encoded in the script)

| Verdict | When |
|---|---|
| **BLOCK** | Any served row with `corpus != 'legacy'` (slice-3C-c invariant violated) — OR unseen fallback reasons — OR shadow fallback rate > 20% — OR shadow p95 > 2× legacy p95. |
| **EXTEND-PREVIEW** | Coverage insufficient (zero-floor: < 100 paired traces even after 7 days, OR < 5000 paired traces in < 7 days) — OR shadow fallback rate > 5% — OR shadow p95 overhead > +50%. |
| **PROCEED-TO-CANARY** | Coverage met AND shadow fallback < 5% AND shadow p95 within +50% of legacy AND no BLOCK conditions. |

The script's recommendation is advisory; CEO authorization is still required before slice 3C-d (canary).

## 6. What the report covers (§§ 1–9 of its output)

1. **Window** — since / until / days observed / total rows.
2. **corpus_routing state** — confirms `Prudential | legacy` (and any other rows).
3. **Pair coverage** — total distinct `request_id`s + how many have BOTH legacy/serve and shadow/preview-only.
4. **Per-corpus / per-mode summary** — count, p50/p95/p99 latency, mean/p50/p95 chunks, fallback count + rate. Explicit row for `shadow/serve` and `legacy/preview-only` to surface any drift (both should be 0 in this slice).
5. **Latency overhead** — shadow p95 vs legacy p95, with the +50% canary threshold called out.
6. **Shadow fallback breakdown** — by `fallback_reason`. Flags any reason outside the design vocabulary (`rpc_error | empty_result | flag_off | timeout`).
7. **Served-corpus invariant** — must show every served row was legacy.
8. **Auditable sample** — up to 10 paired `request_id`s with per-side latency / chunks / fallback for hand inspection.
9. **Recommendation** — verdict + justification bullets.
10. **Guardrails reminder.**

## 7. Smoke result against current state (preview not yet activated)

Run from the VPS on 2026-05-17 21:22 UTC, `--days 30`:

- `corpus_routing`: `Prudential | legacy | migration:...` ✓
- `retrieval_traces`: 1 row (legacy serve, 10 chunks, 7 ms) — confirms 3C-b telemetry is alive in production.
- 0 shadow rows of any mode — confirms preview-only is NOT yet activated (expected; env var unset).
- Served-corpus invariant: **OK** (1/1 served rows were legacy).
- Verdict (after the zero-floor fix in this slice): **EXTEND-PREVIEW** — "only 1 paired trace collected (< 100 floor). Elapsed days alone does not count toward PROCEED without paired evidence. Confirm SHADOW_PREVIEW_INSURERS=Prudential is set on the deployed prod env and that traffic is flowing."

This is the correct verdict for the pre-activation state. The bug surfaced and was fixed: the original logic would have printed PROCEED-TO-CANARY with literally zero paired evidence.

## 8. Guardrails honored (verbatim)

| Guardrail | How honored |
|---|---|
| No real promotion | The script is read-only; no schema or row change |
| No `valid_until = NULL` | Untouched |
| No DELETE | Untouched |
| No row mutation on `documents` | Untouched |
| No Azos / MAG | Script targets Prudential by default; CLI flag allows pointing elsewhere but no slice-level activation here |
| No Agentic RAG / PageIndex | Out of scope |
| No embedder rerun | Untouched |
| No page-span 100 | Untouched |
| Não iniciar canary | The script can only recommend; the canary slice is a future PR |
| Não fazer full flip | Same — no flip code anywhere |
| Não mudar `corpus_routing` para shadow | Script issues no `UPDATE` |

## 9. Open / deferred decisions

- **Aggregation job** (CEO decision at PR #49 merge: weekly aggregation after 30 days granular). Not in this slice. When the time comes it will be a separate migration + cron in the slice that fires it.
- **PII v2** (raw question text behind row-level policy). Still deferred. v1 hash-only continues.
- **Auto-rollback hook** (Supabase edge function on threshold breach). Still deferred. Manual rollback is the floor.

## 10. Recommendation for the next step

Approve and merge this PR (slice 3C-c.1). After merge, run:

```bash
vercel env add SHADOW_PREVIEW_INSURERS production <<<"Prudential"
vercel deploy --prod --force
```

then observe for ≥ 7 days OR ≥ 5000 Prudential single-insurer paired queries. When ready, run the report:

```bash
ssh root@104.131.187.118
cd /root/solomon/repo/app/eval/ragas && source .venv/bin/activate
set -a && source /root/solomon/repo/app/.env.local && set +a
python /root/solomon/repo/app/scripts/phase2/preview-window-report.py --out /tmp/3c-c-preview-report.md
```

and attach the output to the next authorization message. The verdict tells you which of 3C-d (canary), continued preview, or BLOCK is appropriate.
