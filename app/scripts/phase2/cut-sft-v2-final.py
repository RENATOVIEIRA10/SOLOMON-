#!/usr/bin/env python3
"""Stage 3 do dataset SFT v2 — corte final para bedrock-conversation-2024.

Seleciona exemplos accepted=true E faithfulness >= 0.8 (juiz unico gpt-4o-mini),
gera train + heldout (split estratificado por categoria, ~10%) e um manifest
com proveniencia. Deterministico (seed fixa) — re-rodar produz o mesmo split.
"""
import json
import random
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent.parent / "eval" / "fine_tuning"
RAW = BASE / "sft-v2-distilled-raw.jsonl"
SCORES = BASE / "sft-v2-faithfulness.jsonl"
TRAIN = BASE / "solomon-sft-v2-train.jsonl"
HELDOUT = BASE / "solomon-sft-v2-train-heldout.jsonl"
MANIFEST = BASE / "sft-v2-manifest.json"

BAR = 0.8
HELDOUT_FRACTION = 0.1
SEED = 20260611


def to_bedrock(example: dict) -> dict:
    return {
        "schemaVersion": "bedrock-conversation-2024",
        "system": [{"text": example["system"]}],
        "messages": [
            {"role": "user", "content": [{"text": example["question"]}]},
            {"role": "assistant", "content": [{"text": example["assistant"]}]},
        ],
    }


def main() -> None:
    scores = {}
    for line in SCORES.read_text(encoding="utf-8").splitlines():
        d = json.loads(line)
        scores[d["id"]] = d["faithfulness"]

    # Best-of por pergunta-base: variantes -r2/-r3 sao re-amostras da MESMA
    # pergunta — entra no dataset apenas a variante de maior F (>= BAR),
    # nunca duplicatas da mesma pergunta.
    best: dict = {}
    for line in RAW.read_text(encoding="utf-8").splitlines():
        d = json.loads(line)
        f = scores.get(d["id"])
        if not d.get("filters", {}).get("accepted") or f is None or f < BAR:
            continue
        d["_f"] = f
        base = d["id"].split("-r")[0]
        if base not in best or f > best[base]["_f"]:
            best[base] = d
    selected = list(best.values())

    by_cat = defaultdict(list)
    for d in selected:
        by_cat[d["category"]].append(d)

    rng = random.Random(SEED)
    heldout_ids = set()
    for cat, items in sorted(by_cat.items()):
        items_sorted = sorted(items, key=lambda x: x["id"])
        n = max(1, round(len(items_sorted) * HELDOUT_FRACTION))
        heldout_ids.update(d["id"] for d in rng.sample(items_sorted, n))

    train, heldout = [], []
    models = defaultdict(int)
    for d in sorted(selected, key=lambda x: x["id"]):
        models[d.get("production_model") or "?"] += 1
        (heldout if d["id"] in heldout_ids else train).append(d)

    with TRAIN.open("w", encoding="utf-8") as f:
        for d in train:
            f.write(json.dumps(to_bedrock(d), ensure_ascii=False) + "\n")
    with HELDOUT.open("w", encoding="utf-8") as f:
        for d in heldout:
            f.write(json.dumps(to_bedrock(d), ensure_ascii=False) + "\n")

    manifest = {
        "created_at": "2026-06-11",
        "bar_faithfulness": BAR,
        "judge": "gpt-4o-mini (OpenAI direto, juiz unico para os 256)",
        "selected": len(selected),
        "train": len(train),
        "heldout": len(heldout),
        "seed": SEED,
        "answer_models": dict(models),
        "by_category": {k: len(v) for k, v in sorted(by_cat.items())},
        "train_ids": [d["id"] for d in train],
        "heldout_ids": sorted(heldout_ids),
        "provenance": (
            "Respostas destiladas do pipeline guarded de producao (/api/ask evalMode, "
            "master pos-PR #69) sobre sft-v2-questions.jsonl (270 perguntas, anti-contaminacao "
            "Jaccard<=0.55 vs 145 eval questions). Filtros deterministicos + faithfulness>=0.8. "
            "System prompt = SYSTEM_PROMPT_TEMPLATE de producao com contexto real inlined."
        ),
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"selecionados={len(selected)} train={len(train)} heldout={len(heldout)}")
    print("answer_models:", dict(models))
    print("por categoria:", {k: len(v) for k, v in sorted(by_cat.items())})


if __name__ == "__main__":
    main()
