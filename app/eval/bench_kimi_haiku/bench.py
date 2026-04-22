"""
Benchmark cego: Haiku (producao) vs Kimi K2.6 (Ollama) nas MESMAS chunks RAG.

Metodo:
  1. Para cada pergunta, chama /api/ask?evalMode=true (Vercel -> Haiku) e
     captura answer + sources.
  2. Reconstroi o contextText IDENTICO ao que Haiku viu (mesmo formatBlock
     de context-builder.ts).
  3. Monta systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{context}', contextText)
     — copia literal do template em answer.ts.
  4. Chama Kimi via Ollama /v1/chat/completions com systemPrompt + pergunta.
     Mesmos chunks, mesmo prompt — so o LLM muda.
  5. Salva os dois lado-a-lado.

Uso:
    python bench.py [--endpoint URL] [--out-dir PATH] [--ollama URL]

Env vars (opcional):
    SOLOMON_EVAL_ENDPOINT (default: https://app-atalaia.vercel.app/api/ask)
    OLLAMA_URL (default: http://localhost:11434)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
RAGAS_DIR = SCRIPT_DIR.parent / "ragas"
ANSWER_TS = SCRIPT_DIR.parent.parent / "src" / "services" / "rag" / "answer.ts"

DEFAULT_ENDPOINT = "https://app-atalaia.vercel.app/api/ask"
DEFAULT_OLLAMA = "http://localhost:11434"
REQUEST_TIMEOUT = 600  # Kimi K2.6 reasoning em perguntas open-ended chega a 5-10min

# 10 perguntas selecionadas a partir do REPORT.md da rodada 20260421_001234:
# onde Haiku foi pior em faithfulness OU answer_correctness
# (excluindo rate_* = deterministico, e pre_sinistro = Sonnet).
BENCH_IDS = [
    "Q19",  # concept F=0.286 AC=0.097 — Zurich MAIS PROTECAO exclusoes
    "Q26",  # concept F=0.214 AC=0.295 — VG Corporate min vidas
    "Q29",  # concept F=0.103 AC=0.215 — VG Global Icatu (pior hallucination)
    "Q30",  # concept F=0.917 AC=0.101 — Santander Europa (faith alto, content errado)
    "Q34",  # comparison F=0.400 AC=0.350 — MAG DITA vs MAG DIT MAC
    "Q38",  # comparison F=0.500 AC=0.153 — CIB5G vs CIB5H
    "Q39",  # comparison F=0.200 AC=0.390 — TM10/TM15/TM20
    "Q41",  # edge F=0.500 AC=0.439 — "melhor seguro?" (refusal quality)
    "Q42",  # edge F=0.000 AC=0.404 — bolo de chocolate (off-topic refusal)
    "Q45",  # edge F=0.400 AC=0.392 — cirurgia plastica estetica
]


def load_questions() -> list[dict[str, Any]]:
    path = RAGAS_DIR / "questions.jsonl"
    out = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                q = json.loads(line)
                if q["id"] in BENCH_IDS:
                    out.append(q)
    # preservar ordem do BENCH_IDS
    order = {qid: i for i, qid in enumerate(BENCH_IDS)}
    out.sort(key=lambda q: order[q["id"]])
    return out


def extract_system_prompt_template() -> str:
    """Le SYSTEM_PROMPT_TEMPLATE do answer.ts para nao precisar duplicar."""
    text = ANSWER_TS.read_text(encoding="utf-8")
    m = re.search(
        r"export const SYSTEM_PROMPT_TEMPLATE\s*=\s*`(.+?)`",
        text,
        flags=re.DOTALL,
    )
    if not m:
        raise RuntimeError("Nao consegui extrair SYSTEM_PROMPT_TEMPLATE de answer.ts")
    return m.group(1)


def format_block(src: dict[str, Any]) -> str:
    """Replica context-builder.ts#formatBlock (TypeScript) em Python.

    Formato:
        [N] INSURER — PRODUCT
        Processo SUSEP: X          (se susepProcess)
        Fonte: URL                  (se sourceUrl)
        <content>
    """
    lines = [f"[{src['index']}] {src['insurerName']} — {src['productName']}"]
    if src.get("susepProcess"):
        lines.append(f"Processo SUSEP: {src['susepProcess']}")
    if src.get("sourceUrl"):
        lines.append(f"Fonte: {src['sourceUrl']}")
    lines.append(src["content"])
    return "\n".join(lines)


def rebuild_context_text(sources: list[dict[str, Any]]) -> str:
    """Replica context-builder.ts#buildContext output (contextText)."""
    if not sources:
        return ""
    return "\n\n".join(format_block(s) for s in sources)


def http_post_json(url: str, body: dict[str, Any], timeout: int, headers: dict[str, str] | None = None) -> dict[str, Any]:
    data = json.dumps(body).encode()
    hdrs = {"Content-Type": "application/json", "User-Agent": "solomon-bench/1.0"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, method="POST", headers=hdrs)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    start = time.time()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return {"ok": True, "status": r.status, "data": json.loads(raw), "elapsed": time.time() - start}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "status": e.code, "error": raw[:500], "elapsed": time.time() - start}
    except Exception as e:
        return {"ok": False, "status": 0, "error": f"{type(e).__name__}: {e}", "elapsed": time.time() - start}


def call_haiku_vercel(endpoint: str, question: str) -> dict[str, Any]:
    """Chama producao (Vercel) — LLM depende do que o backend rotear.
    ATENCAO: se OpenRouter estiver zerado, cai em Gemini ou GPT-4o-mini.
    Usado so para capturar os SOURCES (chunks RAG); answer sera descartada
    se ANTHROPIC_API_KEY disponivel (preferimos Haiku direto).
    """
    return http_post_json(
        endpoint,
        {"question": question, "evalMode": True, "channel": "api"},
        timeout=REQUEST_TIMEOUT,
    )


def call_haiku_direct(system_prompt: str, user_message: str, api_key: str) -> dict[str, Any]:
    """Chama Claude Haiku 4.5 via API nativa Anthropic — SSoT para baseline."""
    url = "https://api.anthropic.com/v1/messages"
    body = {
        "model": "claude-haiku-4-5",
        "max_tokens": 2048,
        "temperature": 0.3,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "User-Agent": "solomon-bench/1.0",
        },
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    start = time.time()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=REQUEST_TIMEOUT) as r:
            raw = r.read().decode("utf-8")
            resp = json.loads(raw)
            text = "".join(
                b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text"
            )
            usage = resp.get("usage", {})
            return {
                "ok": True,
                "status": r.status,
                "elapsed": time.time() - start,
                "data": {
                    "answer": text,
                    "model": resp.get("model", "claude-haiku-4-5"),
                    "tokensUsed": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
                    "latencyMs": int((time.time() - start) * 1000),
                    "stopReason": resp.get("stop_reason"),
                },
            }
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "status": e.code, "error": raw[:500], "elapsed": time.time() - start}
    except Exception as e:
        return {"ok": False, "status": 0, "error": f"{type(e).__name__}: {e}", "elapsed": time.time() - start}


def call_kimi(ollama_url: str, system_prompt: str, user_message: str) -> dict[str, Any]:
    """Chama Kimi K2.6:cloud via Ollama OpenAI-compatible endpoint.

    Kimi K2.6 tem reasoning separado (campo `reasoning` no message). Se
    max_tokens eh baixo, reasoning estoura e content sai vazio. Subimos para
    8192 e capturamos ambos os campos para fallback.
    """
    url = ollama_url.rstrip("/") + "/v1/chat/completions"
    body = {
        "model": "kimi-k2.6:cloud",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.3,
        "max_tokens": 8192,
        "stream": False,
    }
    result = http_post_json(url, body, timeout=REQUEST_TIMEOUT)
    if not result["ok"]:
        return result
    data = result["data"]
    try:
        msg = data["choices"][0]["message"]
        content = (msg.get("content") or "").strip()
        reasoning = (msg.get("reasoning") or "").strip()
        finish = data["choices"][0].get("finish_reason", "?")
        # Kimi as vezes prefixa com <think>...</think> no content
        content = re.sub(r"<think>.*?</think>\s*", "", content, flags=re.DOTALL).strip()
        # Fallback: se content vazio por estouro de max_tokens, usa reasoning
        # como resposta (ainda eh do mesmo modelo, mas anotado).
        used_reasoning = False
        if not content and reasoning:
            content = reasoning
            used_reasoning = True
        usage = data.get("usage", {})
        return {
            "ok": True,
            "status": result["status"],
            "elapsed": result["elapsed"],
            "data": {
                "answer": content,
                "model": data.get("model", "kimi-k2.6:cloud"),
                "tokensUsed": usage.get("total_tokens", 0),
                "latencyMs": int(result["elapsed"] * 1000),
                "finishReason": finish,
                "usedReasoningFallback": used_reasoning,
                "reasoningChars": len(reasoning),
            },
        }
    except (KeyError, IndexError) as e:
        return {
            "ok": False,
            "status": result["status"],
            "error": f"shape_error: {e} | raw={json.dumps(data)[:300]}",
            "elapsed": result["elapsed"],
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default=os.environ.get("SOLOMON_EVAL_ENDPOINT", DEFAULT_ENDPOINT))
    parser.add_argument("--ollama", default=os.environ.get("OLLAMA_URL", DEFAULT_OLLAMA))
    parser.add_argument("--out-dir", default=str(SCRIPT_DIR / "results"))
    parser.add_argument("--limit", type=int, default=0, help="0 = todas as 10")
    parser.add_argument("--only", default="", help="comma-sep question IDs to run (ex: Q19,Q29)")
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    questions = load_questions()
    if args.only:
        wanted = {x.strip() for x in args.only.split(",") if x.strip()}
        questions = [q for q in questions if q["id"] in wanted]
    if args.limit > 0:
        questions = questions[: args.limit]

    prompt_template = extract_system_prompt_template()

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    mode = "haiku-direct" if anthropic_key else "vercel-fallthrough"

    timestamp = dt.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir) / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== Haiku vs Kimi benchmark — {timestamp} ===")
    print(f"Haiku source:     {mode}")
    print(f"endpoint (src):   {args.endpoint} (usado SO para capturar sources/chunks RAG)")
    print(f"ollama (Kimi):    {args.ollama}")
    print(f"questions:        {len(questions)}")
    print(f"results:          {out_dir}")
    print()

    comparison_path = out_dir / "comparison.jsonl"
    raw_haiku_path = out_dir / "haiku_raw.jsonl"
    raw_kimi_path = out_dir / "kimi_raw.jsonl"

    with comparison_path.open("w", encoding="utf-8") as fcmp, \
         raw_haiku_path.open("w", encoding="utf-8") as fh, \
         raw_kimi_path.open("w", encoding="utf-8") as fk:
        for i, q in enumerate(questions, start=1):
            qid = q["id"]
            print(f"[{i}/{len(questions)}] {qid} [{q['category']}] {q['question'][:80]}")

            # 1a) Chama Vercel SO para capturar sources (chunks RAG). Answer
            # dessa chamada sera descartada quando Anthropic direto estiver
            # disponivel — usamos Haiku direto para garantir baseline real.
            print(f"       -> RAG fetch (sources via Vercel)...", end=" ", flush=True)
            rag = call_haiku_vercel(args.endpoint, q["question"])
            if not rag["ok"]:
                print(f"FAIL status={rag['status']} err={rag.get('error','')[:80]}")
                fh.write(json.dumps({"id": qid, "result": rag}, ensure_ascii=False) + "\n")
                fh.flush()
                continue
            rdata = rag["data"]
            sources = rdata.get("sources") or []
            rag_model = rdata.get("model", "?")
            print(f"OK vercel_model={rag_model} src={len(sources)} ({rag['elapsed']:.1f}s)")

            # Se Vercel foi por rate-lookup (deterministico), Kimi nao tem como
            # comparar de forma justa — pula e anota.
            if rag_model == "rate-table-lookup":
                rec = {
                    "id": qid,
                    "category": q["category"],
                    "question": q["question"],
                    "ground_truth": q["ground_truth"],
                    "haiku": {
                        "answer": rdata.get("answer", ""),
                        "model": rag_model,
                        "note": "Deterministic rate-table lookup, no LLM involved. Skipping Kimi.",
                    },
                    "kimi": None,
                    "shared_contexts": [],
                }
                fcmp.write(json.dumps(rec, ensure_ascii=False) + "\n")
                fcmp.flush()
                continue

            # 2) Reconstroi system prompt EXATO que os chunks produziriam
            context_text = rebuild_context_text(sources) or "Nenhum documento encontrado."
            system_prompt = prompt_template.replace("{context}", context_text)

            # 1b) Haiku real: se tiver ANTHROPIC_API_KEY, chama direto.
            # Caso contrario usa answer do Vercel (pode ser fallback GPT-4o-mini/Gemini).
            if anthropic_key:
                print(f"       -> Haiku 4.5 (Anthropic direct)...", end=" ", flush=True)
                haiku = call_haiku_direct(system_prompt, q["question"], anthropic_key)
                if not haiku["ok"]:
                    print(f"FAIL status={haiku['status']} err={haiku.get('error','')[:120]}")
                    fh.write(json.dumps({"id": qid, "result": haiku}, ensure_ascii=False) + "\n")
                    fh.flush()
                    continue
                hdata = haiku["data"]
                haiku_answer = hdata["answer"]
                haiku_model = hdata["model"]
                print(f"OK model={haiku_model} tokens={hdata['tokensUsed']} stop={hdata.get('stopReason')} ({haiku['elapsed']:.1f}s)")
                fh.write(json.dumps({"id": qid, "question": q["question"], "result": hdata, "sources_from_vercel": rag_model}, ensure_ascii=False) + "\n")
                fh.flush()
            else:
                haiku_answer = rdata.get("answer", "")
                haiku_model = rag_model
                hdata = rdata
                fh.write(json.dumps({"id": qid, "question": q["question"], "result": rdata, "note": "vercel-fallthrough (no ANTHROPIC_API_KEY set)"}, ensure_ascii=False) + "\n")
                fh.flush()

            # 3) Kimi via Ollama (mesmo prompt, mesma pergunta)
            print(f"       -> Kimi K2.6:cloud (Ollama)...", end=" ", flush=True)
            kimi = call_kimi(args.ollama, system_prompt, q["question"])
            if not kimi["ok"]:
                print(f"FAIL status={kimi['status']} err={kimi.get('error','')[:80]}")
                fk.write(json.dumps({"id": qid, "result": kimi}, ensure_ascii=False) + "\n")
                fk.flush()
                kimi_record = {"error": kimi.get("error", "unknown"), "ok": False}
            else:
                kdata = kimi["data"]
                print(f"OK tokens={kdata.get('tokensUsed','?')} ({kimi['elapsed']:.1f}s)")
                fk.write(json.dumps({"id": qid, "question": q["question"], "result": kdata}, ensure_ascii=False) + "\n")
                fk.flush()
                kimi_record = {
                    "answer": kdata["answer"],
                    "model": kdata["model"],
                    "tokensUsed": kdata["tokensUsed"],
                    "latencyMs": kdata["latencyMs"],
                    "ok": True,
                }

            # 4) Comparison record
            rec = {
                "id": qid,
                "category": q["category"],
                "question": q["question"],
                "ground_truth": q["ground_truth"],
                "haiku": {
                    "answer": haiku_answer,
                    "model": haiku_model,
                    "latencyMs": hdata.get("latencyMs"),
                    "tokensUsed": hdata.get("tokensUsed"),
                    "sourceCount": len(sources),
                    "avgSimilarity": hdata.get("avgSimilarity"),
                },
                "kimi": kimi_record,
                "shared_contexts": [
                    {
                        "index": s.get("index"),
                        "insurer": s.get("insurerName"),
                        "product": s.get("productName"),
                        "content": s.get("content"),
                        "sourceUrl": s.get("sourceUrl"),
                    }
                    for s in sources
                ],
            }
            fcmp.write(json.dumps(rec, ensure_ascii=False) + "\n")
            fcmp.flush()

            # rate limit defensivo entre perguntas
            time.sleep(1.0)

    print(f"\n=== done. outputs em {out_dir} ===")
    print(f"   comparison.jsonl = {comparison_path}")
    print(f"   haiku_raw.jsonl  = {raw_haiku_path}")
    print(f"   kimi_raw.jsonl   = {raw_kimi_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
