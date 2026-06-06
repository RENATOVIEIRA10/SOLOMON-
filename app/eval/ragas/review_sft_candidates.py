"""Synthetic review of SOLOMON answers against proposed SFT ground truths.

This is intentionally narrower than a full Ragas run: one independent judge
call per question produces a content-agreement decision suitable for triage.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def response_answer(record: dict[str, Any]) -> str:
    response = record.get("response") or {}
    data = response.get("data") or {}
    return str(data.get("answer") or "").strip()


def source_excerpt(record: dict[str, Any], limit: int = 4, chars: int = 1200) -> str:
    response = record.get("response") or {}
    data = response.get("data") or {}
    sources = data.get("sources") or []
    excerpts = []
    for index, source in enumerate(sources[:limit], start=1):
        content = str(source.get("content") or "").strip()
        if content:
            excerpts.append(f"[{index}] {content[:chars]}")
    return "\n\n".join(excerpts) or "Nenhuma fonte textual retornada."


def build_prompt(record: dict[str, Any]) -> str:
    return f"""Voce e um avaliador independente de qualidade para um assistente de seguros de vida.

Compare a RESPOSTA PROPOSTA com a RESPOSTA REAL DO SOLOMON. Nao presuma que uma delas esta correta apenas por ser chamada de referencia. Verifique:
1. alinhamento semantico e comportamental;
2. contradicoes factuais ou matematicas;
3. se a resposta real omite requisito essencial;
4. se a resposta real inventa informacao nao sustentada;
5. se as fontes retornadas sustentam afirmacoes especificas, quando aplicavel.

Decisao:
- pass: resposta real atende ao objetivo essencial, sem conflito critico;
- review: parcialmente alinhada, ambigua, excessiva ou com ponto nao verificavel;
- fail: contradiz o objetivo, inventa dado relevante ou executa comportamento proibido.

Retorne SOMENTE JSON valido:
{{
  "score": 0,
  "decision": "pass|review|fail",
  "essential_alignment": true,
  "critical_conflict": false,
  "grounding": "supported|partial|not_applicable|unsupported",
  "summary": "explicacao curta",
  "issues": ["problema objetivo, se houver"]
}}

O campo score deve ser um numero inteiro de 0 a 100:
- 90-100: atende integralmente;
- 80-89: atende ao essencial, com diferencas menores;
- 50-79: alinhamento parcial, exige revisao;
- 0-49: incorreta, contraditoria ou inadequada.

ID: {record['id']}
CATEGORIA: {record['category']}
PERGUNTA: {record['question']}

RESPOSTA PROPOSTA:
{record['ground_truth']}

RESPOSTA REAL DO SOLOMON:
{response_answer(record)}

FONTES RETORNADAS:
{source_excerpt(record)}
"""


def parse_json_content(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("judge did not return a JSON object")
    return json.loads(text[start : end + 1])


def call_judge(record: dict[str, Any], api_key: str, model: str) -> dict[str, Any]:
    response = record.get("response") or {}
    if not response.get("ok"):
        return {
            "id": record["id"],
            "category": record["category"],
            "score": None,
            "decision": "api_failure",
            "essential_alignment": False,
            "critical_conflict": False,
            "grounding": "not_applicable",
            "summary": f"SOLOMON request failed with status {response.get('status')}",
            "issues": [str(response.get("error") or "unknown API failure")[:500]],
        }

    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "Avalie com rigor e responda somente JSON valido."},
            {"role": "user", "content": build_prompt(record)},
        ],
    }
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "solomon-sft-review/1.0",
        },
    )

    last_error = ""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=180) as result:
                body = json.loads(result.read().decode("utf-8"))
            content = body["choices"][0]["message"]["content"]
            judged = parse_json_content(content)
            score = max(0, min(100, int(round(float(judged.get("score", 0))))))
            decision = str(judged.get("decision", "review")).lower()
            if decision not in {"pass", "review", "fail"}:
                decision = "review"
            if judged.get("critical_conflict") or score < 50:
                decision = "fail"
            elif score < 80:
                decision = "review"
            else:
                decision = "pass"
            return {
                "id": record["id"],
                "category": record["category"],
                "score": score,
                "decision": decision,
                "essential_alignment": bool(judged.get("essential_alignment")),
                "critical_conflict": bool(judged.get("critical_conflict")),
                "grounding": str(judged.get("grounding", "not_applicable")),
                "summary": str(judged.get("summary", ""))[:1000],
                "issues": [str(item)[:500] for item in (judged.get("issues") or [])[:8]],
            }
        except (
            TimeoutError,
            urllib.error.URLError,
            urllib.error.HTTPError,
            KeyError,
            ValueError,
            json.JSONDecodeError,
        ) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            time.sleep(2**attempt)

    return {
        "id": record["id"],
        "category": record["category"],
        "score": None,
        "decision": "judge_failure",
        "essential_alignment": False,
        "critical_conflict": False,
        "grounding": "not_applicable",
        "summary": "Independent judge failed after retries",
        "issues": [last_error],
    }


def write_report(path: Path, reviews: list[dict[str, Any]], model: str) -> None:
    counts = Counter(review["decision"] for review in reviews)
    scored = [review["score"] for review in reviews if review["score"] is not None]
    category_counts: dict[str, Counter[str]] = defaultdict(Counter)
    for review in reviews:
        category_counts[review["category"]][review["decision"]] += 1

    lines = [
        "# Synthetic SFT comparison",
        "",
        f"- Judge model: `{model}`",
        f"- Total candidates: {len(reviews)}",
        f"- Pass: {counts['pass']}",
        f"- Review: {counts['review']}",
        f"- Fail: {counts['fail']}",
        f"- SOLOMON API failures: {counts['api_failure']}",
        f"- Judge failures: {counts['judge_failure']}",
        f"- Mean score: {sum(scored) / len(scored):.2f}" if scored else "- Mean score: n/a",
        "",
        "## Category breakdown",
        "",
        "| Category | Pass | Review | Fail | API/Judge failure |",
        "|---|---:|---:|---:|---:|",
    ]
    for category in sorted(category_counts):
        counter = category_counts[category]
        failures = counter["api_failure"] + counter["judge_failure"]
        lines.append(
            f"| {category} | {counter['pass']} | {counter['review']} | {counter['fail']} | {failures} |"
        )

    lines.extend(["", "## Items requiring attention", ""])
    attention = sorted(
        (review for review in reviews if review["decision"] != "pass"),
        key=lambda review: (review["score"] is not None, review["score"] or -1),
    )
    for review in attention:
        score = "n/a" if review["score"] is None else str(review["score"])
        lines.append(f"### {review['id']} - {review['decision']} ({score})")
        lines.append("")
        lines.append(review["summary"] or "Sem resumo.")
        for issue in review["issues"]:
            lines.append(f"- {issue}")
        lines.append("")

    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--model",
        default=os.environ.get("OPENROUTER_JUDGE_MODEL", "anthropic/claude-3-haiku"),
    )
    args = parser.parse_args()

    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("OPENROUTER_API_KEY is required")

    records = load_jsonl(args.raw)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    reviews: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {executor.submit(call_judge, record, api_key, args.model): record for record in records}
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            record = futures[future]
            review = future.result()
            response = record.get("response") or {}
            data = response.get("data") or {}
            review.update(
                {
                    "question": record["question"],
                    "proposed_ground_truth": record["ground_truth"],
                    "solomon_answer": response_answer(record),
                    "source_count": len(data.get("sources") or []),
                }
            )
            reviews.append(review)
            print(
                f"[{index:02d}/{len(records)}] {review['id']} "
                f"decision={review['decision']} score={review['score']}",
                flush=True,
            )

    order = {record["id"]: index for index, record in enumerate(records)}
    reviews.sort(key=lambda review: order[review["id"]])
    output = args.out_dir / "synthetic_review.jsonl"
    output.write_text(
        "\n".join(json.dumps(review, ensure_ascii=False) for review in reviews) + "\n",
        encoding="utf-8",
    )
    write_report(args.out_dir / "SYNTHETIC_REVIEW.md", reviews, args.model)
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
