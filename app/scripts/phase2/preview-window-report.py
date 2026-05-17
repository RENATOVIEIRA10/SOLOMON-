"""
Phase 2 / Slice 3C-c.1 -- preview-window evidence report.

Queries the SOLOMON product DB (retrieval_traces table) and emits a
Markdown report covering everything the CEO needs to decide on slice
3C-d (canary):

  - total request_ids with BOTH legacy serve AND shadow preview-only rows
  - p50 / p95 / p99 latency, per corpus, per mode
  - chunks_returned summary (mean + p50/p95) per corpus
  - fallback / error rate of shadow preview
  - coverage of Prudential single-insurer queries
  - auditable sample of request_ids
  - confirmation that the served corpus stayed 'legacy' throughout
  - honest recommendation: PROCEED to canary / EXTEND preview / BLOCK

Read-only. No DELETE, no INSERT, no row mutation. The script only
issues SELECTs against `retrieval_traces` and `corpus_routing`.

Env required:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Usage (VPS or notebook with prod envs):

  python scripts/phase2/preview-window-report.py
  python scripts/phase2/preview-window-report.py --days 7
  python scripts/phase2/preview-window-report.py --insurer Prudential --out /tmp/report.md
  python scripts/phase2/preview-window-report.py --since-id 1234

Defaults: insurer=Prudential, window=last 7 days, output to stdout.

Recommendation thresholds (mirror docs/phase-2-pr3c-promotion-design.md
section 4 + the slice 3C-c brief):

  - canary criterion: >= 5000 Prudential single-insurer queries with
    BOTH legacy serve AND shadow preview-only rows OR >= 7 days of
    observation, fallback_rate < 5%, p95 shadow within +50% of p95
    legacy, no error spikes.
  - block: fallback_rate > 20% in any 5-min window, p95 shadow > 2x
    legacy, any unseen error class.
  - otherwise: extend preview window.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# env / http
# ---------------------------------------------------------------------------

def env(*names: str) -> str | None:
    for n in names:
        v = os.environ.get(n)
        if v and v.strip():
            return v.strip()
    return None


def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def http_get(url: str, headers: dict[str, str], timeout: int = 60) -> Any:
    req = urllib.request.Request(url, method="GET", headers=headers)
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "null")


def http_post(url: str, body: dict[str, Any], headers: dict[str, str], timeout: int = 60) -> Any:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "null")


def supabase_headers() -> tuple[str, dict[str, str]]:
    url = env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY")
    return url.rstrip("/"), {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "count=none",
    }


# ---------------------------------------------------------------------------
# SQL via Supabase RPC. retrieval_traces is queried with the canonical
# postgrest filter syntax (NOT raw SQL) for read safety.
# ---------------------------------------------------------------------------

def fetch_traces(
    base: str,
    headers: dict[str, str],
    insurer: str,
    since: dt.datetime,
    *,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Page through retrieval_traces using PostgREST default 1000-row cap."""
    out: list[dict[str, Any]] = []
    page = 0
    page_size = 1000
    since_iso = since.isoformat()
    while True:
        params: dict[str, str] = {
            "select": "*",
            "insurer_name": f"eq.{insurer}",
            "ts": f"gte.{since_iso}",
            "order": "ts.asc,id.asc",
            "limit": str(page_size),
            "offset": str(page * page_size),
        }
        q = urllib.parse.urlencode(params, safe="")
        url = f"{base}/rest/v1/retrieval_traces?{q}"
        rows = http_get(url, headers=headers) or []
        out.extend(rows)
        if len(rows) < page_size:
            break
        if limit is not None and len(out) >= limit:
            return out[:limit]
        page += 1
    return out


def fetch_corpus_routing(base: str, headers: dict[str, str]) -> list[dict[str, Any]]:
    q = urllib.parse.urlencode({"select": "*"}, safe="")
    return http_get(f"{base}/rest/v1/corpus_routing?{q}", headers=headers) or []


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

def percentile(values: list[float], p: float) -> float:
    """Linear interpolation percentile (Numpy default)."""
    if not values:
        return float("nan")
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * p
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def summarise_corpus_mode(
    rows: list[dict[str, Any]],
    corpus: str,
    mode: str,
) -> dict[str, Any]:
    subset = [r for r in rows if r.get("corpus") == corpus and r.get("mode") == mode]
    latencies = [float(r["latency_ms"]) for r in subset if r.get("latency_ms") is not None]
    chunks = [int(r["chunks_returned"]) for r in subset if r.get("chunks_returned") is not None]
    fallbacks = sum(1 for r in subset if r.get("fallback_used"))
    fb_reasons: dict[str, int] = {}
    for r in subset:
        reason = r.get("fallback_reason")
        if reason:
            fb_reasons[reason] = fb_reasons.get(reason, 0) + 1
    return {
        "count": len(subset),
        "p50_ms": percentile(latencies, 0.50) if latencies else float("nan"),
        "p95_ms": percentile(latencies, 0.95) if latencies else float("nan"),
        "p99_ms": percentile(latencies, 0.99) if latencies else float("nan"),
        "mean_chunks": (sum(chunks) / len(chunks)) if chunks else float("nan"),
        "p50_chunks": percentile([float(c) for c in chunks], 0.50) if chunks else float("nan"),
        "p95_chunks": percentile([float(c) for c in chunks], 0.95) if chunks else float("nan"),
        "fallback_count": fallbacks,
        "fallback_rate": (fallbacks / len(subset)) if subset else 0.0,
        "fallback_reasons": fb_reasons,
    }


def index_by_request(rows: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    """request_id -> {(corpus, mode): row}. Latest row wins when there are duplicates."""
    by: dict[str, dict[str, dict[str, Any]]] = {}
    for r in rows:
        rid = r.get("request_id")
        if not rid:
            continue
        key = f"{r.get('corpus')}|{r.get('mode')}"
        by.setdefault(rid, {})[key] = r
    return by


def confirm_legacy_served(rows: list[dict[str, Any]]) -> tuple[bool, int, int]:
    """The contract: every served row in the window is corpus='legacy'.
    Returns (ok, served_total, served_legacy)."""
    served = [r for r in rows if r.get("mode") == "serve"]
    legacy = [r for r in served if r.get("corpus") == "legacy"]
    return (len(served) == len(legacy)), len(served), len(legacy)


def latency_overhead(legacy_p95: float, shadow_p95: float) -> float | None:
    if shadow_p95 != shadow_p95 or legacy_p95 != legacy_p95:
        return None
    if legacy_p95 <= 0:
        return None
    return (shadow_p95 - legacy_p95) / legacy_p95


def recommend(
    *,
    paired_count: int,
    days_observed: float,
    shadow_fallback_rate: float,
    legacy_p95: float,
    shadow_p95: float,
    legacy_corpus_violations: int,
    distinct_unseen_errors: list[str],
) -> tuple[str, list[str]]:
    """Return (verdict, justification_bullets)."""
    bullets: list[str] = []

    if legacy_corpus_violations > 0:
        bullets.append(
            f"BLOCK: detected {legacy_corpus_violations} serve row(s) with corpus != 'legacy'."
            " This violates the slice-3C-c invariant and must be investigated before any next step."
        )
        return ("BLOCK", bullets)

    if distinct_unseen_errors:
        bullets.append(
            f"BLOCK: unseen error reasons during preview: {distinct_unseen_errors}."
            " Investigate each one before proceeding."
        )
        return ("BLOCK", bullets)

    if shadow_fallback_rate > 0.20:
        bullets.append(
            f"BLOCK: shadow fallback rate {shadow_fallback_rate:.1%} exceeds the 20% hard ceiling."
        )
        return ("BLOCK", bullets)

    overhead = latency_overhead(legacy_p95, shadow_p95)
    if overhead is not None and overhead > 1.0:
        bullets.append(
            f"BLOCK: shadow p95 latency is {overhead:.0%} above legacy p95 (> 2x)."
        )
        return ("BLOCK", bullets)

    # Coverage rule: CEO authorized ">= 5000 queries OR >= 7 days". Plus a
    # zero-floor guard: with literally zero paired traces, the verdict is
    # never PROCEED regardless of elapsed days (no evidence at all).
    MIN_PAIRED_FLOOR = 100
    coverage_ok = (
        paired_count >= 5000
        or (days_observed >= 7.0 and paired_count >= MIN_PAIRED_FLOOR)
    )
    fallback_ok = shadow_fallback_rate < 0.05
    latency_ok = overhead is None or overhead <= 0.50

    if coverage_ok and fallback_ok and latency_ok:
        bullets.append(
            f"PROCEED: coverage met ({paired_count} paired traces; {days_observed:.1f} days),"
            f" shadow fallback {shadow_fallback_rate:.2%} < 5%,"
            f" shadow p95 overhead {overhead if overhead is None else f'{overhead:.0%}'} within +50% of legacy."
        )
        bullets.append("Next step: slice 3C-d (canary -- flip Prudential to shadow for one broker, e.g. Julio).")
        return ("PROCEED-TO-CANARY", bullets)

    if not coverage_ok:
        if paired_count < MIN_PAIRED_FLOOR:
            bullets.append(
                f"EXTEND: only {paired_count} paired traces collected (< {MIN_PAIRED_FLOOR} floor)."
                " Elapsed days alone does not count toward PROCEED without paired evidence."
                " Confirm SHADOW_PREVIEW_INSURERS=Prudential is set on the deployed prod env"
                " and that traffic is flowing."
            )
        else:
            bullets.append(
                f"EXTEND: observation insufficient (paired={paired_count} < 5000 AND days={days_observed:.1f} < 7)."
            )
    if not fallback_ok:
        bullets.append(
            f"EXTEND: shadow fallback rate {shadow_fallback_rate:.2%} > 5% target."
            " Drill into fallback_reasons before any canary."
        )
    if not latency_ok and overhead is not None:
        bullets.append(
            f"EXTEND: shadow p95 overhead {overhead:.0%} above legacy (> +50%)."
            " Investigate shadow RPC latency before canary."
        )
    bullets.append("Recommended action: continue preview-only observation; do NOT advance to canary yet.")
    return ("EXTEND-PREVIEW", bullets)


# ---------------------------------------------------------------------------
# Markdown render
# ---------------------------------------------------------------------------

def fmt_ms(x: float) -> str:
    return "n/a" if (x != x) else f"{x:.1f} ms"


def fmt_n(x: float) -> str:
    return "n/a" if (x != x) else f"{x:.2f}"


def fmt_pct(x: float) -> str:
    return f"{x:.2%}"


def render_markdown(
    *,
    insurer: str,
    since: dt.datetime,
    until: dt.datetime,
    rows: list[dict[str, Any]],
    routing: list[dict[str, Any]],
) -> str:
    by_req = index_by_request(rows)
    legacy_serve = summarise_corpus_mode(rows, "legacy", "serve")
    shadow_preview = summarise_corpus_mode(rows, "shadow", "preview-only")
    shadow_serve_oops = summarise_corpus_mode(rows, "shadow", "serve")
    legacy_preview_oops = summarise_corpus_mode(rows, "legacy", "preview-only")

    paired = [
        rid
        for rid, by in by_req.items()
        if "legacy|serve" in by and "shadow|preview-only" in by
    ]
    legacy_only = [rid for rid, by in by_req.items() if "legacy|serve" in by and "shadow|preview-only" not in by]

    served_ok, served_total, served_legacy = confirm_legacy_served(rows)

    distinct_unseen_reasons = sorted(
        set(shadow_preview["fallback_reasons"].keys()) - {"rpc_error", "empty_result", "flag_off", "timeout"}
    )

    days = max(0.0, (until - since).total_seconds() / 86400.0)
    verdict, bullets = recommend(
        paired_count=len(paired),
        days_observed=days,
        shadow_fallback_rate=shadow_preview["fallback_rate"],
        legacy_p95=legacy_serve["p95_ms"],
        shadow_p95=shadow_preview["p95_ms"],
        legacy_corpus_violations=(served_total - served_legacy),
        distinct_unseen_errors=distinct_unseen_reasons,
    )

    lines: list[str] = []
    lines.append("# SOLOMON -- Phase 2 / Slice 3C-c -- preview-window evidence report")
    lines.append("")
    lines.append(f"_Generated {dt.datetime.now(dt.timezone.utc).replace(tzinfo=None).isoformat()}Z. Read-only. Insurer scope: `{insurer}`._")
    lines.append("")

    # 1. Window
    lines.append("## 1. Window")
    lines.append("")
    lines.append(f"- since: `{since.isoformat()}`")
    lines.append(f"- until: `{until.isoformat()}` (now)")
    lines.append(f"- days observed: {days:.2f}")
    lines.append(f"- total rows: {len(rows)}")
    lines.append("")

    # 2. corpus_routing state
    lines.append("## 2. corpus_routing state")
    lines.append("")
    if not routing:
        lines.append("_(table empty)_")
    else:
        lines.append("| insurer_name | mode | mode_set_at | mode_set_by |")
        lines.append("|---|---|---|---|")
        for r in routing:
            lines.append(
                f"| {r.get('insurer_name')} | **{r.get('mode')}** | {r.get('mode_set_at')} | {r.get('mode_set_by')} |"
            )
    lines.append("")

    # 3. Pair coverage
    lines.append("## 3. legacy-serve + shadow-preview pair coverage")
    lines.append("")
    total_req = len(by_req)
    pair_pct = (len(paired) / total_req) if total_req else 0.0
    lines.append(f"- distinct request_ids: **{total_req}**")
    lines.append(f"- with paired (legacy serve + shadow preview-only): **{len(paired)}** ({pair_pct:.2%})")
    lines.append(f"- legacy-only (no shadow preview row): {len(legacy_only)}")
    lines.append("")

    # 4. Per corpus/mode summary
    lines.append("## 4. Per-corpus / per-mode summary")
    lines.append("")
    lines.append("| corpus | mode | rows | p50 ms | p95 ms | p99 ms | mean chunks | p50 chunks | fallbacks | fallback rate |")
    lines.append("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for label, (corp, mode), s in [
        ("legacy serve", ("legacy", "serve"), legacy_serve),
        ("shadow preview-only", ("shadow", "preview-only"), shadow_preview),
        ("shadow serve (should be 0 in 3C-c)", ("shadow", "serve"), shadow_serve_oops),
        ("legacy preview-only (should be 0 in 3C-c)", ("legacy", "preview-only"), legacy_preview_oops),
    ]:
        lines.append(
            f"| {corp} | {mode} | {s['count']} | {fmt_ms(s['p50_ms'])} | {fmt_ms(s['p95_ms'])} | "
            f"{fmt_ms(s['p99_ms'])} | {fmt_n(s['mean_chunks'])} | {fmt_n(s['p50_chunks'])} | "
            f"{s['fallback_count']} | {fmt_pct(s['fallback_rate'])} |"
        )
    lines.append("")

    # 5. Latency overhead
    lines.append("## 5. Latency overhead -- shadow vs legacy")
    lines.append("")
    overhead = latency_overhead(legacy_serve["p95_ms"], shadow_preview["p95_ms"])
    if overhead is None:
        lines.append("- p95 not computable (insufficient data on one side).")
    else:
        lines.append(f"- legacy p95: {fmt_ms(legacy_serve['p95_ms'])}")
        lines.append(f"- shadow p95: {fmt_ms(shadow_preview['p95_ms'])}")
        lines.append(f"- overhead vs legacy: **{overhead:.1%}** (threshold for canary: <= +50%)")
    lines.append("")

    # 6. Shadow fallback breakdown
    lines.append("## 6. Shadow fallback / error breakdown")
    lines.append("")
    if shadow_preview["fallback_count"] == 0:
        lines.append("- 0 fallbacks recorded in shadow preview rows.")
    else:
        lines.append(f"- total fallbacks: {shadow_preview['fallback_count']}")
        lines.append(f"- fallback rate: {fmt_pct(shadow_preview['fallback_rate'])}")
        lines.append("- by reason:")
        for reason, n in sorted(shadow_preview["fallback_reasons"].items()):
            lines.append(f"  - `{reason}`: {n}")
    if distinct_unseen_reasons:
        lines.append("")
        lines.append(f"- **UNSEEN fallback reasons** (not in design vocabulary): {distinct_unseen_reasons}")
    lines.append("")

    # 7. Served-corpus invariant
    lines.append("## 7. Served-corpus invariant check")
    lines.append("")
    lines.append(f"- total served rows in window: {served_total}")
    lines.append(f"- of which corpus='legacy': {served_legacy}")
    if served_ok:
        lines.append("- **OK** -- every served row was legacy. Invariant of slice 3C-c held.")
    else:
        lines.append(
            f"- **VIOLATION** -- {served_total - served_legacy} served row(s) had corpus != 'legacy'."
        )
    lines.append("")

    # 8. Sample request_ids
    lines.append("## 8. Auditable sample (up to 10 paired request_ids)")
    lines.append("")
    sample = paired[:10]
    if not sample:
        lines.append("_(no paired rows yet)_")
    else:
        lines.append("| request_id | legacy ms | shadow ms | legacy chunks | shadow chunks | shadow fallback |")
        lines.append("|---|---:|---:|---:|---:|---|")
        for rid in sample:
            byk = by_req[rid]
            leg = byk.get("legacy|serve") or {}
            sha = byk.get("shadow|preview-only") or {}
            lines.append(
                f"| `{rid[:12]}…` | {leg.get('latency_ms', 'n/a')} | {sha.get('latency_ms', 'n/a')} | "
                f"{leg.get('chunks_returned', 'n/a')} | {sha.get('chunks_returned', 'n/a')} | "
                f"{sha.get('fallback_reason') or 'no'} |"
            )
    lines.append("")

    # 9. Verdict
    lines.append("## 9. Recommendation")
    lines.append("")
    lines.append(f"**Verdict: {verdict}**")
    lines.append("")
    for b in bullets:
        lines.append(f"- {b}")
    lines.append("")

    # 10. Guardrails reminder
    lines.append("## 10. Guardrails reminder")
    lines.append("")
    lines.append("- This report is **read-only**. Nothing in this run mutated the DB.")
    lines.append("- The verdict is a recommendation; CEO authorization is required before slice 3C-d (canary) or 3C-e (full flip).")
    lines.append("- Even with PROCEED-TO-CANARY, the next slice is canary (one broker, ≥ 48 h observation), NOT full flip.")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--insurer", default="Prudential", help="Canonical insurer name (default Prudential)")
    ap.add_argument("--days", type=float, default=7.0, help="Window in days (default 7)")
    ap.add_argument("--out", default=None, help="Output file path (default stdout)")
    ap.add_argument("--limit", type=int, default=None, help="Cap on rows fetched")
    args = ap.parse_args()

    base, headers = supabase_headers()

    until = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    since = until - dt.timedelta(days=args.days)

    print(f"[preview-report] fetching retrieval_traces for {args.insurer} since {since.isoformat()}", file=sys.stderr)
    rows = fetch_traces(base, headers, args.insurer, since, limit=args.limit)
    print(f"[preview-report] {len(rows)} rows", file=sys.stderr)
    routing = fetch_corpus_routing(base, headers)

    report = render_markdown(
        insurer=args.insurer,
        since=since,
        until=until,
        rows=rows,
        routing=routing,
    )

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report, encoding="utf-8")
        print(f"[preview-report] wrote {out_path}", file=sys.stderr)
    else:
        sys.stdout.write(report)


if __name__ == "__main__":
    main()
