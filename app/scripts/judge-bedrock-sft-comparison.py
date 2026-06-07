#!/usr/bin/env python3
import argparse
import concurrent.futures
import json
import os
import urllib.request
from collections import Counter
from pathlib import Path


URL = "https://openrouter.ai/api/v1/chat/completions"


def load_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def judge(item, api_key: str, model: str):
    prompt = f"""Avalie duas respostas para uma pergunta inedita do SOLOMON.
Compare cada resposta com a resposta esperada. Priorize correcao, seguranca,
seguimento da instrucao e ausencia de invencao. Verbosidade extra nao e ganho.

Retorne somente JSON valido:
{{
  "fine_tuned_score": 0,
  "production_score": 0,
  "winner": "fine_tuned|production|tie",
  "fine_tuned_critical_error": false,
  "production_critical_error": false,
  "summary": "justificativa curta"
}}

As notas sao inteiros de 0 a 100. Empate quando a diferenca for menor que 5.

PERGUNTA: {item['question']}
RESPOSTA ESPERADA: {item['ground_truth']}

MODELO SFT:
{item['fine_tuned_answer']}

SOLOMON PRODUCAO:
{item['production_answer']}
"""
    request = urllib.request.Request(
        URL,
        data=json.dumps({
            "model": model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": "Responda apenas JSON valido e avalie sem favorecer respostas longas."},
                {"role": "user", "content": prompt},
            ],
        }).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        body = json.loads(response.read().decode())
    content = body["choices"][0]["message"]["content"]
    result = json.loads(content[content.find("{"):content.rfind("}") + 1])
    result["id"] = item["id"]
    result["category"] = item["category"]
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--model", default="anthropic/claude-3-haiku")
    args = parser.parse_args()
    api_key = os.environ["OPENROUTER_API_KEY"]
    items = load_jsonl(args.input)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(judge, item, api_key, args.model) for item in items]
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            print(f"[{index:02d}/{len(items)}] {result['id']} winner={result['winner']}", flush=True)

    order = {item["id"]: index for index, item in enumerate(items)}
    results.sort(key=lambda item: order[item["id"]])
    counts = Counter(item["winner"] for item in results)
    ft_mean = sum(int(item["fine_tuned_score"]) for item in results) / len(results)
    prod_mean = sum(int(item["production_score"]) for item in results) / len(results)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "judgments.jsonl").write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in results) + "\n",
        encoding="utf-8",
    )
    report = [
        "# SOLOMON SFT held-out comparison",
        "",
        f"- Cases: {len(results)}",
        f"- Fine-tuned wins: {counts['fine_tuned']}",
        f"- Production wins: {counts['production']}",
        f"- Ties: {counts['tie']}",
        f"- Fine-tuned mean score: {ft_mean:.2f}",
        f"- Production mean score: {prod_mean:.2f}",
        "",
        "## Per case",
        "",
        "| ID | Category | SFT | Production | Winner |",
        "|---|---|---:|---:|---|",
    ]
    for item in results:
        report.append(
            f"| {item['id']} | {item['category']} | {item['fine_tuned_score']} | "
            f"{item['production_score']} | {item['winner']} |"
        )
    report.extend(["", "## Judge notes", ""])
    for item in results:
        report.extend([f"### {item['id']}", "", item["summary"], ""])
    (args.out_dir / "REPORT.md").write_text("\n".join(report), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
