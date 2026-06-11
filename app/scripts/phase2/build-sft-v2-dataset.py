#!/usr/bin/env python3
"""Builder do dataset SFT v2 (RAG-grounded) — destila o pipeline guarded de producao.

Para cada pergunta de sft-v2-questions.jsonl:
  POST /api/ask (evalMode + token) -> answer + sources[] (chunks com content)
  Reconstroi o systemPrompt EXATO de producao (SYSTEM_PROMPT_TEMPLATE + contexto
  formatado como formatBlock do context-builder.ts) e grava o exemplo bruto.

Filtros deterministicos (exemplo so e accepted=true se passar TODOS):
  - resposta nao veio de guard deterministico (domain/insurer-source/claim-verdict)
  - >= 2 sources com content nao-vazio
  - answer >= 300 chars, com pelo menos uma citacao [N] e secao FONTES UTILIZADAS
  - sem __ERRO__

Saida: sft-v2-distilled-raw.jsonl (checkpoint-resumable). O corte final para
bedrock-conversation-2024 acontece DEPOIS do judge de faithfulness (stage 2).

Rodar na VPS a partir de /root/solomon/repo:
  SOLOMON_EVAL_TOKEN=... python3 app/scripts/phase2/build-sft-v2-dataset.py
"""
import json
import os
import re
import time
import urllib.request

TOKEN = os.environ["SOLOMON_EVAL_TOKEN"]
ENDPOINT = "https://app-atalaia.vercel.app/api/ask"
SRC = "app/eval/fine_tuning/sft-v2-questions.jsonl"
OUT = "app/eval/fine_tuning/sft-v2-distilled-raw.jsonl"
ANSWER_TS = "app/src/services/rag/answer.ts"

GUARD_MODELS = {"domain-guard", "insurer-source-guard", "claim-verdict-guard"}
CITATION_RE = re.compile(r"\[\d+\]")


def load_system_template() -> str:
    src = open(ANSWER_TS, encoding="utf-8").read()
    m = re.search(r"export const SYSTEM_PROMPT_TEMPLATE = `(.*?)`\n", src, re.DOTALL)
    if not m:
        raise SystemExit("SYSTEM_PROMPT_TEMPLATE nao encontrado em answer.ts")
    tpl = m.group(1)
    if "{context}" not in tpl or "DOCUMENTOS DE REFERENCIA:" not in tpl:
        raise SystemExit("Template extraido nao tem os marcadores esperados")
    return tpl


def format_block(s: dict) -> str:
    # Espelha formatBlock de context-builder.ts
    lines = []
    header = f"[{s.get('index')}] {s.get('insurerName')} — {s.get('productName')}"
    if s.get("sourceDoc"):
        header += f" | Documento: {s['sourceDoc']}"
    page = s.get("page")
    if page not in (None, ""):
        header += f" | Página: {page}"
    lines.append(header)
    if s.get("susepProcess"):
        lines.append(f"Processo SUSEP: {s['susepProcess']}")
    if s.get("sourceUrl"):
        lines.append(f"Fonte: {s['sourceUrl']}")
    lines.append(s.get("content") or "")
    return "\n".join(lines)


def apply_filters(answer: str, model: str, sources: list) -> dict:
    checks = {
        "not_guard": model not in GUARD_MODELS,
        "min_sources": len([s for s in sources if (s.get("content") or "").strip()]) >= 2,
        "min_length": len(answer or "") >= 300,
        "has_citation": bool(CITATION_RE.search(answer or "")),
        "has_fontes": "FONTES UTILIZADAS" in (answer or ""),
        "no_error": not (answer or "").startswith("__ERRO__"),
    }
    checks["accepted"] = all(checks.values())
    return checks


def main() -> None:
    template = load_system_template()
    done, out = set(), []
    if os.path.exists(OUT):
        for line in open(OUT, encoding="utf-8"):
            d = json.loads(line)
            out.append(d)
            done.add(d["id"])

    cases = [json.loads(l) for l in open(SRC, encoding="utf-8")]
    accepted = sum(1 for d in out if d.get("filters", {}).get("accepted"))
    for i, c in enumerate(cases, 1):
        if c["id"] in done:
            continue
        t0 = time.time()
        body = json.dumps({"evalMode": True, "question": c["question"]}).encode()
        req = urllib.request.Request(
            ENDPOINT, data=body,
            headers={"Content-Type": "application/json", "x-solomon-eval-token": TOKEN},
        )
        try:
            resp = json.loads(urllib.request.urlopen(req, timeout=150).read().decode())
            answer = resp.get("answer") or ""
            model = resp.get("model") or ""
            sources = resp.get("sources") or []
        except Exception as e:  # noqa: BLE001 — falha de rede vira reject, nao aborta o run
            answer, model, sources = f"__ERRO__: {e}", "error", []

        context_text = "\n\n".join(format_block(s) for s in sources) or "Nenhum documento encontrado."
        filters = apply_filters(answer, model, sources)
        if filters["accepted"]:
            accepted += 1
        out.append({
            **c,
            "system": template.replace("{context}", context_text),
            "assistant": answer,
            "contexts": [s.get("content") or "" for s in sources],
            "production_model": model,
            "production_tokens": resp.get("tokensUsed") if model != "error" else None,
            "filters": filters,
        })
        with open(OUT, "w", encoding="utf-8") as f:
            for d in out:
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
        flag = "OK " if filters["accepted"] else "REJ"
        print(f"[{i:03d}] {c['id']} {flag} model={model} {time.time()-t0:.1f}s (accepted={accepted})", flush=True)

    print(f"DONE {len(out)} processados, {accepted} aceitos -> {OUT}")


if __name__ == "__main__":
    main()
