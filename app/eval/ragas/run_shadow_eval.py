"""
Phase 2 / Slice 3B.6.4 -- Ragas LLM judge on the scoped Prudential set.

Scope (per CEO authorization 2026-05-17):
  - context_precision + context_recall ONLY (no answer generation).
  - 9 scoped Qs x {legacy match_documents, shadow match_shadow_documents}.
  - In-scope conditions drives decision; control_rate_table and
    out_of_scope_commercial are informational.

Why CP + CR only:
  CP and CR are exactly the metrics where the keyword-overlap proxy
  reached its evidentiary limit on Q16 (PR #47, slice 3B.7.10). They
  judge retrieval quality semantically without needing a generated
  answer. Skipping faithfulness / AC / NS keeps this PR small AND
  guardrail-safe: zero answer.ts coupling, zero read-path edit,
  zero prompt replication risk.

Guardrails (per CEO):
  - No promotion. No DELETE. No read-path change. No embedder rerun.
  - No edits to match_documents / match_shadow_documents / answer.ts /
    compare.ts.
  - Production reads continue at their own match_count.

Run on VPS:
  cd /root/solomon/repo/app/eval/ragas && source .venv/bin/activate
  set -a && source /root/agents/config/.env \\
         && source /root/solomon/repo/app/.env.local && set +a
  python run_shadow_eval.py

Outputs in app/eval/ragas/results/shadow-<UTC>/:
  - raw_retrieval.jsonl   (Q, scope, corpus, contexts, GT, ids/similarity)
  - ragas_per_row.csv     (per-row CP + CR scores from judge)
  - aggregates.json       (per-scope x per-corpus aggregates + delta)
  - REPORT.md             (executive summary)
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
RESULTS_ROOT = SCRIPT_DIR / "results"

# Scoped set: ids + scope tags (mirror app/src/services/azure-di/shadow-eval-metrics.ts).
# Scope drives aggregation: only 'conditions' feeds the decision.
SHADOW_SCOPED_QUESTIONS: list[dict[str, str]] = [
    {"id": "Q16", "scope": "conditions"},
    {"id": "Q17", "scope": "conditions"},
    {"id": "Q26", "scope": "out_of_scope_commercial"},
    {"id": "Q31", "scope": "conditions"},
    {"id": "Q32", "scope": "conditions"},
    {"id": "Q36", "scope": "conditions"},
    {"id": "Q37", "scope": "conditions"},
    {"id": "Q38", "scope": "control_rate_table"},
    {"id": "Q39", "scope": "control_rate_table"},
]

INSURER_MATCH = "Prudential do Brasil"
EMBEDDING_MODEL = "text-embedding-3-small"
MATCH_COUNT = 10
MATCH_THRESHOLD = 0.0


# -------------------- env / http --------------------

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


def http_post(url: str, body: dict[str, Any], headers: dict[str, str], timeout: int = 60) -> dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def http_get(url: str, headers: dict[str, str], timeout: int = 30) -> Any:
    req = urllib.request.Request(url, method="GET", headers=headers)
    with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "null")


# -------------------- Supabase / embeddings --------------------

def supabase_headers() -> tuple[str, dict[str, str]]:
    url = env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY")
    return url.rstrip("/"), {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def get_insurer_id(base: str, headers: dict[str, str]) -> str:
    q = urllib.parse.urlencode({"select": "id,name", "name": f"ilike.*{INSURER_MATCH}*"})
    rows = http_get(f"{base}/rest/v1/insurers?{q}", headers=headers)
    if not rows:
        sys.exit(f"No insurer matches ilike {INSURER_MATCH!r}")
    rows.sort(key=lambda r: len(r["name"]))
    return rows[0]["id"]


def embed_text(text: str) -> list[float]:
    """OpenAI text-embedding-3-small (same as production embedder.ts)."""
    api_key = env("OPENAI_API_KEY")
    if not api_key:
        sys.exit("Missing OPENAI_API_KEY")
    resp = http_post(
        "https://api.openai.com/v1/embeddings",
        body={"model": EMBEDDING_MODEL, "input": text},
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        timeout=60,
    )
    return resp["data"][0]["embedding"]


def call_rpc(
    base: str,
    headers: dict[str, str],
    fn: str,
    args: dict[str, Any],
) -> list[dict[str, Any]]:
    """Call a Postgres RPC via PostgREST. Mirrors the supabase-js client.rpc()."""
    url = f"{base}/rest/v1/rpc/{fn}"
    return http_post(url, body=args, headers=headers, timeout=60) or []


def pgvector_literal(emb: list[float]) -> str:
    return "[" + ",".join(repr(x) if isinstance(x, float) else str(x) for x in emb) + "]"


# -------------------- ground truth load --------------------

def load_ground_truths() -> dict[str, dict[str, Any]]:
    """Load the 9 scoped Qs (id, question, ground_truth) from questions.jsonl."""
    path = SCRIPT_DIR / "questions.jsonl"
    if not path.exists():
        sys.exit(f"Missing {path}")
    ids_we_need = {q["id"] for q in SHADOW_SCOPED_QUESTIONS}
    by_id: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if row.get("id") in ids_we_need:
                by_id[row["id"]] = row
    missing = ids_we_need - by_id.keys()
    if missing:
        sys.exit(f"questions.jsonl missing scoped ids: {sorted(missing)}")
    return by_id


# -------------------- retrieval --------------------

def retrieve_for_question(
    base: str,
    headers: dict[str, str],
    insurer_id: str,
    question: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Embed once, dispatch to both match_documents (legacy) and match_shadow_documents (shadow).
    Same query_embedding, same insurer, same match_count, same threshold."""
    emb = embed_text(question)
    pgv = pgvector_literal(emb)
    args = {
        "query_embedding": pgv,
        "match_threshold": MATCH_THRESHOLD,
        "match_count": MATCH_COUNT,
        "filter_insurer_id": insurer_id,
    }
    legacy = call_rpc(base, headers, "match_documents", args)
    shadow = call_rpc(base, headers, "match_shadow_documents", args)
    return legacy, shadow


def chunks_to_contexts(chunks: list[dict[str, Any]]) -> list[str]:
    """Reduce each chunk to a plain text context. Ragas judges receive these
    verbatim. We include section/heading hints when present (mirror of
    getScoringText in shadow-eval-metrics.ts) so the judge sees the same
    surface the proxy did."""
    out: list[str] = []
    for ch in chunks:
        content = (ch.get("content") or "").strip()
        if not content:
            continue
        meta = ch.get("metadata") or {}
        section = meta.get("section") or ""
        heading = meta.get("heading_path") or ""
        if isinstance(heading, list):
            heading = " > ".join(str(p) for p in heading)
        section_title = meta.get("section_title") or ""
        header_parts = [p for p in (heading, section, section_title) if p and isinstance(p, str)]
        if header_parts:
            content = "[" + " | ".join(header_parts) + "]\n" + content
        out.append(content)
    return out


# -------------------- Ragas eval --------------------

def build_ragas_dataset(rows: list[dict[str, Any]]):
    """Build a Ragas-compatible Dataset for CP + CR only.

    Each row: {user_input, retrieved_contexts, reference}.
    Ragas 0.2 uses these column names natively for SingleTurnSample.
    No 'response'/'answer' column needed since CP + CR don't read it.
    """
    from datasets import Dataset

    data = {
        "user_input": [r["question"] for r in rows],
        "retrieved_contexts": [r["contexts"] for r in rows],
        "reference": [r["ground_truth"] for r in rows],
    }
    return Dataset.from_dict(data)


def run_ragas(ds, judge_backend: str, *, max_workers: int = 4, timeout: int = 600) -> Any:
    """Run Ragas with LLMContextPrecisionWithReference + LLMContextRecall only.

    Both metrics are LLM-judge based and use the reference (GT) plus the
    retrieved contexts. No answer column is consumed.

    Concurrency control: Ragas defaults to 16 workers and 180s timeout.
    For CP over 10 chunks/row x 18 rows we saw all jobs hit 180s under
    Gemini throttling. max_workers=4 + timeout=600 keeps the API happy.
    """
    # Import metrics + evaluate locally so module import in --help doesn't
    # pull heavy deps.
    from ragas import evaluate
    from ragas.metrics import LLMContextPrecisionWithReference, LLMContextRecall
    from ragas.run_config import RunConfig

    os.environ.setdefault("JUDGE_BACKEND", judge_backend)
    from metrics import build_evaluator_embeddings, build_evaluator_llm
    llm = build_evaluator_llm()
    emb = build_evaluator_embeddings()

    metrics = [LLMContextPrecisionWithReference(), LLMContextRecall()]
    run_config = RunConfig(max_workers=max_workers, timeout=timeout, max_retries=2)
    result = evaluate(
        dataset=ds,
        metrics=metrics,
        llm=llm,
        embeddings=emb,
        raise_exceptions=False,
        show_progress=True,
        run_config=run_config,
    )
    return result


# -------------------- main --------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="Cap on questions (smoke)")
    ap.add_argument("--judge-backend", default=os.environ.get("JUDGE_BACKEND", "gemini"),
                    choices=["anthropic", "gemini"],
                    help="LLM judge backend (default: gemini, ~62%% cheaper than Haiku)")
    ap.add_argument("--max-workers", type=int, default=4,
                    help="Ragas concurrency (default: 4 -- keeps Gemini happy)")
    ap.add_argument("--ragas-timeout", type=int, default=600,
                    help="Per-job Ragas timeout in seconds (default: 600)")
    ap.add_argument("--out-root", default=str(RESULTS_ROOT))
    args = ap.parse_args()

    base, headers = supabase_headers()
    insurer_id = get_insurer_id(base, headers)
    gts = load_ground_truths()
    questions = SHADOW_SCOPED_QUESTIONS[: args.limit] if args.limit else SHADOW_SCOPED_QUESTIONS

    ts = dt.datetime.utcnow().strftime("%Y%m%d_%H%M%SZ")
    out_dir = Path(args.out_root) / f"shadow-{ts}"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"# Phase 2 / Slice 3B.6.4 -- Ragas LLM judge (CP + CR only)")
    print(f"insurer={INSURER_MATCH} ({insurer_id})")
    print(f"embedding={EMBEDDING_MODEL} match_count={MATCH_COUNT} threshold={MATCH_THRESHOLD}")
    print(f"judge_backend={args.judge_backend}")
    print(f"questions={len(questions)} of {len(SHADOW_SCOPED_QUESTIONS)}")
    print(f"out_dir={out_dir}")
    print()

    rows: list[dict[str, Any]] = []
    raw_path = out_dir / "raw_retrieval.jsonl"
    t0 = time.time()
    with raw_path.open("w", encoding="utf-8") as f:
        for i, q in enumerate(questions, 1):
            qid = q["id"]
            scope = q["scope"]
            gt_row = gts[qid]
            question_text = gt_row["question"]
            ground_truth = gt_row["ground_truth"]
            print(f"[{i:>2}/{len(questions)}] {qid} ({scope}) -- {question_text[:70]}")
            legacy_chunks, shadow_chunks = retrieve_for_question(
                base, headers, insurer_id, question_text
            )
            print(f"   legacy_chunks={len(legacy_chunks)} shadow_chunks={len(shadow_chunks)}")
            legacy_row = {
                "id": qid,
                "scope": scope,
                "corpus": "legacy",
                "question": question_text,
                "ground_truth": ground_truth,
                "chunk_ids": [c.get("id") for c in legacy_chunks],
                "similarities": [c.get("similarity") for c in legacy_chunks],
                "contexts": chunks_to_contexts(legacy_chunks),
            }
            shadow_row = {
                "id": qid,
                "scope": scope,
                "corpus": "shadow",
                "question": question_text,
                "ground_truth": ground_truth,
                "chunk_ids": [c.get("id") for c in shadow_chunks],
                "similarities": [c.get("similarity") for c in shadow_chunks],
                "contexts": chunks_to_contexts(shadow_chunks),
            }
            f.write(json.dumps(legacy_row, ensure_ascii=False) + "\n")
            f.write(json.dumps(shadow_row, ensure_ascii=False) + "\n")
            rows.append(legacy_row)
            rows.append(shadow_row)
    print(f"retrieval done in {time.time() - t0:.1f}s  ({len(rows)} rows)")
    print()

    print(f"running Ragas evaluate (CP + CR) "
          f"max_workers={args.max_workers} timeout={args.ragas_timeout}s ...")
    ds = build_ragas_dataset(rows)
    t1 = time.time()
    result = run_ragas(
        ds,
        args.judge_backend,
        max_workers=args.max_workers,
        timeout=args.ragas_timeout,
    )
    elapsed = time.time() - t1
    print(f"ragas done in {elapsed:.1f}s")

    # Persist per-row scores as CSV (mirror existing run_eval.py pattern).
    df = result.to_pandas()
    # Re-attach id/scope/corpus by ROW POSITION (Ragas 0.2.x drops extra cols).
    df["id"] = [r["id"] for r in rows]
    df["scope"] = [r["scope"] for r in rows]
    df["corpus"] = [r["corpus"] for r in rows]
    csv_path = out_dir / "ragas_per_row.csv"
    df.to_csv(csv_path, index=False, encoding="utf-8")
    print(f"per-row scores: {csv_path}")

    # Per-scope x per-corpus aggregates.
    cp_col = next((c for c in df.columns if "context_precision" in c.lower()), None)
    cr_col = next((c for c in df.columns if "context_recall" in c.lower()), None)
    if not cp_col or not cr_col:
        sys.exit(f"Could not find CP/CR columns in {list(df.columns)}")

    aggregates: dict[str, Any] = {
        "config": {
            "judge_backend": args.judge_backend,
            "embedding_model": EMBEDDING_MODEL,
            "match_count": MATCH_COUNT,
            "match_threshold": MATCH_THRESHOLD,
            "insurer": INSURER_MATCH,
            "metrics": ["context_precision (LLMContextPrecisionWithReference)", "context_recall (LLMContextRecall)"],
            "cp_col": cp_col,
            "cr_col": cr_col,
        },
        "by_scope": {},
        "global": {},
    }
    for scope in ("conditions", "control_rate_table", "out_of_scope_commercial"):
        scope_df = df[df["scope"] == scope]
        if scope_df.empty:
            continue
        aggregates["by_scope"][scope] = {
            "q_count": int(scope_df["id"].nunique()),
            "legacy_cp": float(scope_df[scope_df["corpus"] == "legacy"][cp_col].mean()),
            "legacy_cr": float(scope_df[scope_df["corpus"] == "legacy"][cr_col].mean()),
            "shadow_cp": float(scope_df[scope_df["corpus"] == "shadow"][cp_col].mean()),
            "shadow_cr": float(scope_df[scope_df["corpus"] == "shadow"][cr_col].mean()),
        }
        agg = aggregates["by_scope"][scope]
        agg["delta_cp"] = agg["shadow_cp"] - agg["legacy_cp"]
        agg["delta_cr"] = agg["shadow_cr"] - agg["legacy_cr"]

    agg_path = out_dir / "aggregates.json"
    agg_path.write_text(json.dumps(aggregates, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"aggregates: {agg_path}")

    # Human-readable REPORT.md.
    report = render_report(rows, df, aggregates, cp_col, cr_col)
    (out_dir / "REPORT.md").write_text(report, encoding="utf-8")
    print(f"report: {out_dir / 'REPORT.md'}")

    # Final stop-signal verdict on in-scope conditions only.
    cond = aggregates["by_scope"].get("conditions")
    if cond and (cond["delta_cp"] < 0 or cond["delta_cr"] < 0):
        print()
        print(f"STOP SIGNAL: shadow regressed on in-scope conditions aggregate. "
              f"delta_cp={cond['delta_cp']:+.3f} delta_cr={cond['delta_cr']:+.3f}")
        sys.exit(1)
    print()
    print("STOP SIGNAL CLEAR: shadow neutral or better than legacy on in-scope conditions.")


def render_report(rows: list[dict[str, Any]], df: Any, aggregates: dict[str, Any], cp_col: str, cr_col: str) -> str:
    cfg = aggregates["config"]
    lines: list[str] = []
    lines.append("# SOLOMON -- Phase 2 / Slice 3B.6.4 -- Ragas CP + CR")
    lines.append("")
    lines.append("## Config")
    lines.append("")
    lines.append(f"- judge_backend: {cfg['judge_backend']}")
    lines.append(f"- embedding_model: {cfg['embedding_model']}")
    lines.append(f"- match_count: {cfg['match_count']}")
    lines.append(f"- match_threshold: {cfg['match_threshold']}")
    lines.append(f"- insurer: {cfg['insurer']}")
    lines.append(f"- metrics: context_precision (LLMContextPrecisionWithReference) + context_recall (LLMContextRecall)")
    lines.append(f"- generated: {dt.datetime.utcnow().isoformat()}Z")
    lines.append("")
    lines.append("## Per-row scores")
    lines.append("")
    lines.append("| id | scope | corpus | CP | CR | n_contexts |")
    lines.append("|---|---|---|---:|---:|---:|")
    for r in rows:
        sub = df[(df["id"] == r["id"]) & (df["corpus"] == r["corpus"])]
        cp = float(sub[cp_col].iloc[0]) if len(sub) else float("nan")
        cr = float(sub[cr_col].iloc[0]) if len(sub) else float("nan")
        lines.append(f"| {r['id']} | {r['scope']} | {r['corpus']} | {cp:.3f} | {cr:.3f} | {len(r['contexts'])} |")
    lines.append("")
    lines.append("## Aggregates by scope")
    lines.append("")
    lines.append("| scope | Qs | legacy CP | shadow CP | dCP | legacy CR | shadow CR | dCR |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    for scope, agg in aggregates["by_scope"].items():
        lines.append(
            f"| {scope} | {agg['q_count']} | {agg['legacy_cp']:.3f} | {agg['shadow_cp']:.3f} | {agg['delta_cp']:+.3f} "
            f"| {agg['legacy_cr']:.3f} | {agg['shadow_cr']:.3f} | {agg['delta_cr']:+.3f} |"
        )
    lines.append("")
    lines.append("## Stop signal")
    lines.append("")
    cond = aggregates["by_scope"].get("conditions")
    if not cond:
        lines.append("No in-scope conditions rows -- nothing to gate.")
    elif cond["delta_cp"] < 0 or cond["delta_cr"] < 0:
        lines.append(
            f"**STOP** -- shadow regressed on in-scope conditions: "
            f"dCP={cond['delta_cp']:+.3f}, dCR={cond['delta_cr']:+.3f}."
        )
    else:
        lines.append(
            f"**CLEAR** -- shadow >= legacy on in-scope conditions: "
            f"dCP={cond['delta_cp']:+.3f}, dCR={cond['delta_cr']:+.3f}."
        )
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
