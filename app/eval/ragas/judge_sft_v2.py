#!/usr/bin/env python3
"""Stage 2 do dataset SFT v2 — faithfulness judge sobre os exemplos destilados.

Le ../fine_tuning/sft-v2-distilled-raw.jsonl (so accepted=true), roda Ragas
faithfulness (answer vs contexts) e grava ../fine_tuning/sft-v2-faithfulness.jsonl
com {id, faithfulness}. Checkpoint por bloco — pode interromper e retomar.

Judge: cross-family de proposito — as respostas sao do Gemini, o judge e Haiku
via Anthropic nativa (JUDGE_BACKEND=anthropic) para evitar self-preference em
dados de TREINO.

Rodar na VPS:
  cd /root/solomon/repo/app/eval/ragas && source .venv/bin/activate
  set -a && source /root/agents/config/.env && source ../../.env.local && set +a
  JUDGE_BACKEND=anthropic RAGAS_MAX_WORKERS=4 python judge_sft_v2.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "fine_tuning" / "sft-v2-distilled-raw.jsonl"
OUT = Path(__file__).resolve().parent.parent / "fine_tuning" / "sft-v2-faithfulness.jsonl"
BATCH = 20


def main() -> None:
    from datasets import Dataset
    from ragas import evaluate
    from ragas.metrics import faithfulness
    from ragas.run_config import RunConfig

    from metrics import build_evaluator_llm

    done: dict[str, float] = {}
    if OUT.exists():
        for line in OUT.read_text(encoding="utf-8").splitlines():
            d = json.loads(line)
            done[d["id"]] = d["faithfulness"]

    examples = []
    for line in RAW.read_text(encoding="utf-8").splitlines():
        d = json.loads(line)
        if d.get("filters", {}).get("accepted") and d["id"] not in done:
            examples.append(d)

    print(f"{len(done)} ja julgados, {len(examples)} pendentes")
    if not examples:
        print("DONE nada pendente")
        return

    llm = build_evaluator_llm()
    run_config = RunConfig(
        max_workers=int(os.environ.get("RAGAS_MAX_WORKERS", "4")),
        timeout=int(os.environ.get("RAGAS_TIMEOUT", "300")),
        max_retries=3,
        max_wait=90,
    )

    for start in range(0, len(examples), BATCH):
        chunk = examples[start : start + BATCH]
        rows = [
            {
                "question": e["question"],
                "answer": e["assistant"],
                "contexts": [c for c in e["contexts"] if c.strip()],
                "ground_truth": "",
            }
            for e in chunk
        ]
        result = evaluate(
            dataset=Dataset.from_list(rows),
            metrics=[faithfulness],
            llm=llm,
            run_config=run_config,
        )
        df = result.to_pandas()
        with OUT.open("a", encoding="utf-8") as f:
            for e, score in zip(chunk, df["faithfulness"].tolist()):
                val = None if score != score else round(float(score), 4)  # NaN -> None
                f.write(json.dumps({"id": e["id"], "faithfulness": val}, ensure_ascii=False) + "\n")
                print(f"{e['id']} F={val}", flush=True)

    total = len(OUT.read_text(encoding="utf-8").splitlines())
    print(f"DONE {total} julgados -> {OUT}")


if __name__ == "__main__":
    main()
