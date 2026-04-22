"""
Blind pairwise judge: Sonnet 4.6 avalia respostas Haiku vs Kimi
contra ground_truth e chunks compartilhados.

- Sonnet 4.6 como juiz evita bias "Haiku julgando Haiku".
- Randomiza A/B order em cada pergunta para eliminar position bias.
- Scores por dimensao: faithfulness (grounded nos chunks), correctness
  (alinhado com ground truth), usefulness (qualidade pro corretor).
- Produz: scores.jsonl por pergunta + aggregate.json + REPORT.md

Uso:
    source /c/tmp/bench-keys.env
    python judge.py [--run RESULTS_DIR]  # default: ultimo run
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
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

JUDGE_MODEL = "claude-sonnet-4-5"  # Sonnet 4.6 alias usado pela API; verificar live
JUDGE_TIMEOUT = 120

JUDGE_SYSTEM = """Voce e um avaliador especialista em respostas de sistemas RAG para corretores de seguros de vida no Brasil.

Sua tarefa: julgar DUAS respostas (A e B) a uma pergunta, dado o ground_truth e os chunks RAG que AMBAS usaram como contexto. Voce NAO sabe qual LLM gerou A ou B — julgue so pelo conteudo.

Dimensoes (cada uma pontuada 0.0 a 1.0, duas casas decimais):

1. FAITHFULNESS — A resposta e grounded nos chunks fornecidos?
   - 1.00 = todas as afirmacoes factuais sao verificaveis nos chunks
   - 0.50 = mistura fatos dos chunks com afirmacoes nao fundamentadas
   - 0.00 = inventa / contradiz os chunks

2. CORRECTNESS — A resposta bate com o ground_truth?
   - 1.00 = bate em conteudo e precisao (permite paraphrasing)
   - 0.50 = parcialmente correta (alguns pontos certos, outros errados ou faltando)
   - 0.00 = contradiz o ground_truth ou esta completamente errada

3. USEFULNESS — A resposta e util pro corretor na pratica?
   - 1.00 = clara, direta, acionavel, cita fontes corretamente, alerta pegadinhas
   - 0.50 = razoavelmente util mas generica ou com ruido
   - 0.00 = inutil, confusa, ou vazia

4. WINNER — Qual resposta e melhor NO GERAL para um corretor usar?
   - "A" | "B" | "tie"

IMPORTANTE:
- Nao e uma corrida de tamanho. Respostas curtas e certas ganham de longas e vagas.
- Se o ground_truth pede CLARIFICACAO (ex: pergunta ambigua), a melhor resposta e aquela que PEDE CONTEXTO em vez de chutar.
- Se a pergunta e fora de escopo (ex: "como fazer bolo"), a melhor resposta e aquela que RECUSA educadamente e redireciona.

RETORNE APENAS JSON VALIDO no formato:
{
  "faithfulness_a": 0.00, "correctness_a": 0.00, "usefulness_a": 0.00,
  "faithfulness_b": 0.00, "correctness_b": 0.00, "usefulness_b": 0.00,
  "winner": "A|B|tie",
  "reasoning": "1-2 frases explicando o veredicto"
}"""


def http_post_json(url: str, body: dict[str, Any], headers: dict[str, str], timeout: int) -> dict[str, Any]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    start = time.time()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            return {"ok": True, "status": r.status, "data": json.loads(r.read().decode("utf-8")), "elapsed": time.time() - start}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "error": e.read().decode("utf-8", errors="replace")[:800], "elapsed": time.time() - start}
    except Exception as e:
        return {"ok": False, "status": 0, "error": f"{type(e).__name__}: {e}", "elapsed": time.time() - start}


def call_judge(api_key: str, question: str, ground_truth: str, contexts: list[dict[str, Any]], answer_a: str, answer_b: str) -> dict[str, Any]:
    """Chama Sonnet 4.6 como juiz. Retorna dict com scores + winner ou erro."""
    ctx_text = "\n\n".join(
        f"[{c.get('index','?')}] {c.get('insurer','?')} — {c.get('product','?')}\n{c.get('content','')[:2000]}"
        for c in contexts[:10]  # limitar para nao estourar ctx do juiz
    ) or "(nenhum chunk — pergunta fora de escopo)"

    user_msg = f"""PERGUNTA:
{question}

GROUND TRUTH (esperado):
{ground_truth}

CHUNKS RAG (contexto compartilhado entre A e B):
{ctx_text}

---

RESPOSTA A:
{answer_a}

---

RESPOSTA B:
{answer_b}

---

Avalie as duas respostas nas 4 dimensoes. Retorne APENAS o JSON valido no formato especificado."""

    body = {
        "model": JUDGE_MODEL,
        "max_tokens": 1024,
        "temperature": 0.0,
        "system": JUDGE_SYSTEM,
        "messages": [{"role": "user", "content": user_msg}],
    }
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    r = http_post_json("https://api.anthropic.com/v1/messages", body, headers, JUDGE_TIMEOUT)
    if not r["ok"]:
        return {"ok": False, "error": r.get("error", "?")}
    try:
        content = r["data"]["content"]
        text = "".join(b.get("text", "") for b in content if b.get("type") == "text").strip()
        # Extrai JSON (juiz pode embrulhar em ```json ... ```)
        m = re.search(r"\{[\s\S]+\}", text)
        if not m:
            return {"ok": False, "error": f"no_json_in_response: {text[:300]}"}
        scores = json.loads(m.group(0))
        return {"ok": True, "scores": scores, "raw_text": text, "elapsed": r["elapsed"]}
    except Exception as e:
        return {"ok": False, "error": f"parse_err: {e} | text={text[:300]}"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", default="", help="path to results dir (default: most recent)")
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY nao setado. source /c/tmp/bench-keys.env primeiro.", file=sys.stderr)
        return 1

    results_root = SCRIPT_DIR / "results"
    if args.run:
        run_dir = Path(args.run)
    else:
        runs = sorted([d for d in results_root.iterdir() if d.is_dir()], reverse=True)
        if not runs:
            print("ERROR: nenhum run em results/", file=sys.stderr)
            return 1
        run_dir = runs[0]

    comparison_path = run_dir / "comparison.jsonl"
    if not comparison_path.exists():
        print(f"ERROR: {comparison_path} nao existe", file=sys.stderr)
        return 1

    print(f"=== Judge run: {run_dir.name} ===")
    print(f"Juiz: {JUDGE_MODEL} (Anthropic direto)")
    print()

    scores_path = run_dir / "judge_scores.jsonl"
    aggregate_path = run_dir / "judge_aggregate.json"

    per_record: list[dict[str, Any]] = []
    with comparison_path.open(encoding="utf-8") as f, scores_path.open("w", encoding="utf-8") as out:
        for line in f:
            if not line.strip():
                continue
            rec = json.loads(line)
            qid = rec["id"]
            # Pula rate-table-lookup e kimi-fail
            if rec.get("haiku", {}).get("model") == "rate-table-lookup":
                print(f"{qid}: SKIP (rate-table-lookup, sem LLM)")
                continue
            if not rec.get("kimi") or not rec["kimi"].get("ok", True):
                print(f"{qid}: SKIP (kimi fail: {rec.get('kimi',{}).get('error','?')[:60]})")
                continue

            # Randomiza A/B order (determinista via hash do qid pra reprodutibilidade)
            flip = int(hashlib.md5(qid.encode()).hexdigest(), 16) % 2 == 0
            if flip:
                a_label, a_answer = "haiku", rec["haiku"]["answer"]
                b_label, b_answer = "kimi",  rec["kimi"]["answer"]
            else:
                a_label, a_answer = "kimi",  rec["kimi"]["answer"]
                b_label, b_answer = "haiku", rec["haiku"]["answer"]

            print(f"{qid} [{rec['category']}] A={a_label} B={b_label} ... ", end="", flush=True)

            result = call_judge(
                api_key,
                rec["question"],
                rec["ground_truth"],
                rec.get("shared_contexts", []),
                a_answer,
                b_answer,
            )
            if not result["ok"]:
                print(f"FAIL: {result['error'][:80]}")
                continue

            s = result["scores"]
            # Demapear de A/B para haiku/kimi
            haiku_scores = {
                "faithfulness": s["faithfulness_a"] if a_label == "haiku" else s["faithfulness_b"],
                "correctness": s["correctness_a"] if a_label == "haiku" else s["correctness_b"],
                "usefulness": s["usefulness_a"] if a_label == "haiku" else s["usefulness_b"],
            }
            kimi_scores = {
                "faithfulness": s["faithfulness_a"] if a_label == "kimi" else s["faithfulness_b"],
                "correctness": s["correctness_a"] if a_label == "kimi" else s["correctness_b"],
                "usefulness": s["usefulness_a"] if a_label == "kimi" else s["usefulness_b"],
            }
            winner_label = s["winner"]
            winner = "tie"
            if winner_label == "A":
                winner = a_label
            elif winner_label == "B":
                winner = b_label

            out_rec = {
                "id": qid,
                "category": rec["category"],
                "question": rec["question"][:100],
                "winner": winner,
                "haiku": haiku_scores,
                "kimi": kimi_scores,
                "reasoning": s.get("reasoning", ""),
                "blind_order": [a_label, b_label],
                "haiku_latency_ms": rec.get("haiku", {}).get("latencyMs"),
                "kimi_latency_ms": rec.get("kimi", {}).get("latencyMs"),
            }
            out.write(json.dumps(out_rec, ensure_ascii=False) + "\n")
            out.flush()
            per_record.append(out_rec)
            print(f"winner={winner} haikuF={haiku_scores['faithfulness']:.2f} kimiF={kimi_scores['faithfulness']:.2f} ({result['elapsed']:.1f}s)")
            time.sleep(0.5)

    # Agregado
    if not per_record:
        print("Nenhum resultado — abortando agregacao.")
        return 1

    agg = {
        "n": len(per_record),
        "haiku": {
            "faithfulness": sum(r["haiku"]["faithfulness"] for r in per_record) / len(per_record),
            "correctness":  sum(r["haiku"]["correctness"]  for r in per_record) / len(per_record),
            "usefulness":   sum(r["haiku"]["usefulness"]   for r in per_record) / len(per_record),
            "avg_latency_ms": sum(r.get("haiku_latency_ms") or 0 for r in per_record) / len(per_record),
        },
        "kimi": {
            "faithfulness": sum(r["kimi"]["faithfulness"] for r in per_record) / len(per_record),
            "correctness":  sum(r["kimi"]["correctness"]  for r in per_record) / len(per_record),
            "usefulness":   sum(r["kimi"]["usefulness"]   for r in per_record) / len(per_record),
            "avg_latency_ms": sum(r.get("kimi_latency_ms") or 0 for r in per_record) / len(per_record),
        },
        "wins": {
            "haiku": sum(1 for r in per_record if r["winner"] == "haiku"),
            "kimi":  sum(1 for r in per_record if r["winner"] == "kimi"),
            "tie":   sum(1 for r in per_record if r["winner"] == "tie"),
        },
    }
    aggregate_path.write_text(json.dumps(agg, indent=2, ensure_ascii=False), encoding="utf-8")

    print()
    print("=== AGREGADO ===")
    print(json.dumps(agg, indent=2, ensure_ascii=False))
    print()
    print(f"scores por pergunta: {scores_path}")
    print(f"agregado:            {aggregate_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
