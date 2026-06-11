#!/usr/bin/env python3
"""Retry de destilacao para exemplos reprovados do SFT v2.

Respostas de producao sao estocasticas: re-amostrar a MESMA pergunta gera
resposta nova que pode passar os filtros + faithfulness. Re-pergunta os ids
com accepted=false OU F<0.8 e appenda em sft-v2-distilled-raw.jsonl com
sufixo "-r2" (o judge processa como pendente; o corte deduplica por base id
preferindo maior F).

Rodar na VPS: SOLOMON_EVAL_TOKEN=... python3 app/scripts/phase2/retry-sft-v2-rejects.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Reusa funcoes do builder (mesmo formato, mesmos filtros)
import importlib.util

spec = importlib.util.spec_from_file_location(
    "builder", os.path.join(os.path.dirname(os.path.abspath(__file__)), "build-sft-v2-dataset.py")
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

import time
import urllib.request

RAW = "app/eval/fine_tuning/sft-v2-distilled-raw.jsonl"
SCORES = "app/eval/fine_tuning/sft-v2-faithfulness.jsonl"
BAR = 0.8


def main() -> None:
    scores = {}
    for line in open(SCORES, encoding="utf-8"):
        d = json.loads(line)
        scores[d["id"]] = d["faithfulness"]

    entries = [json.loads(l) for l in open(RAW, encoding="utf-8")]
    existing_ids = {e["id"] for e in entries}
    template = builder.load_system_template()

    retry = []
    for e in entries:
        if "-r2" in e["id"]:
            continue
        f = scores.get(e["id"])
        failed = (not e.get("filters", {}).get("accepted")) or (f is not None and f < BAR)
        if failed and f is None and e.get("filters", {}).get("accepted"):
            failed = False  # accepted mas nao julgado ainda — deixa o judge tratar
        if failed and (e["id"] + "-r2") not in existing_ids:
            retry.append(e)

    print(f"{len(retry)} ids para retry")
    for i, c in enumerate(retry, 1):
        t0 = time.time()
        body = json.dumps({"evalMode": True, "question": c["question"]}).encode()
        req = urllib.request.Request(
            builder.ENDPOINT, data=body,
            headers={"Content-Type": "application/json", "x-solomon-eval-token": builder.TOKEN},
        )
        try:
            resp = json.loads(urllib.request.urlopen(req, timeout=150).read().decode())
            answer = resp.get("answer") or ""
            model = resp.get("model") or ""
            sources = resp.get("sources") or []
        except Exception as exc:  # noqa: BLE001
            answer, model, sources = f"__ERRO__: {exc}", "error", []

        context_text = "\n\n".join(builder.format_block(s) for s in sources) or "Nenhum documento encontrado."
        filters = builder.apply_filters(answer, model, sources)
        new = {
            "id": c["id"] + "-r2",
            "category": c["category"],
            "insurer": c.get("insurer"),
            "question": c["question"],
            "system": template.replace("{context}", context_text),
            "assistant": answer,
            "contexts": [s.get("content") or "" for s in sources],
            "production_model": model,
            "production_tokens": resp.get("tokensUsed") if model != "error" else None,
            "filters": filters,
        }
        entries.append(new)
        with open(RAW, "w", encoding="utf-8") as f:
            for d in entries:
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
        flag = "OK " if filters["accepted"] else "REJ"
        print(f"[{i:03d}] {new['id']} {flag} model={model} {time.time()-t0:.1f}s", flush=True)

    print(f"DONE retry {len(retry)}")


if __name__ == "__main__":
    main()
