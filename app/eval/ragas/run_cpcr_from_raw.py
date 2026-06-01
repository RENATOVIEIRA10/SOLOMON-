"""
Run Ragas CP/CR from a run_eval.py raw.jsonl file.

This is a narrow local runner for retrieval blocker work: it skips answer
generation metrics and evaluates only context_precision + context_recall.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


def load_records(path: Path, limit: int = 0) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            rows.append(json.loads(line))
            if limit > 0 and len(rows) >= limit:
                break
    return rows


def record_contexts(record: dict[str, Any]) -> list[str]:
    response = record.get("response") or {}
    data = response.get("data") or {}
    model = data.get("model", "")
    answer = data.get("answer") or ""
    contexts: list[str] = []

    for source in data.get("sources") or []:
        content = source.get("content") or ""
        if not content:
            continue
        insurer = source.get("insurerName") or source.get("insurer")
        product = source.get("productName")
        prefix_parts = [str(p) for p in (insurer, product) if p]
        if prefix_parts:
            content = f"[{' - '.join(prefix_parts)}]\n{content}"
        contexts.append(content)

    if model == "rate-table-lookup" and not contexts and answer:
        contexts = [answer]
    return contexts or ["<nenhum chunk recuperado>"]


def build_dataset(records: list[dict[str, Any]]):
    from datasets import Dataset

    rows = []
    ids: list[str] = []
    categories: list[str] = []
    for record in records:
        if not (record.get("response") or {}).get("ok"):
            continue
        rows.append({
            "user_input": record["question"],
            "retrieved_contexts": record_contexts(record),
            "reference": record["ground_truth"],
        })
        ids.append(record["id"])
        categories.append(record.get("category", ""))
    return Dataset.from_list(rows), ids, categories


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", required=True)
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--judge-backend", default=os.environ.get("JUDGE_BACKEND", "gemini"))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-workers", type=int, default=1)
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()

    os.environ["JUDGE_BACKEND"] = args.judge_backend

    raw_path = Path(args.raw)
    out_dir = Path(args.out_dir) if args.out_dir else raw_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    records = load_records(raw_path, args.limit)
    dataset, ids, categories = build_dataset(records)
    if len(dataset) == 0:
        raise SystemExit("No OK records in raw file")

    from ragas import evaluate
    from ragas.metrics import LLMContextPrecisionWithReference, LLMContextRecall
    from ragas.run_config import RunConfig
    from metrics import build_evaluator_embeddings, build_evaluator_llm

    result = evaluate(
        dataset=dataset,
        metrics=[LLMContextPrecisionWithReference(), LLMContextRecall()],
        llm=build_evaluator_llm(),
        embeddings=build_evaluator_embeddings(),
        raise_exceptions=True,
        show_progress=True,
        run_config=RunConfig(
            max_workers=args.max_workers,
            timeout=args.timeout,
            max_retries=2,
            max_wait=90,
        ),
    )

    df = result.to_pandas()
    df["id"] = ids
    df["category"] = categories
    csv_path = out_dir / "ragas_cpcr_per_question.csv"
    json_path = out_dir / "ragas_cpcr_scores.json"
    df.to_csv(csv_path, index=False, encoding="utf-8")
    json_path.write_text(
        json.dumps({k: float(v) for k, v in result._repr_dict.items()}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"rows={len(dataset)}")
    print(f"csv={csv_path}")
    print(f"scores={json_path}")
    print(json.dumps({k: float(v) for k, v in result._repr_dict.items()}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
