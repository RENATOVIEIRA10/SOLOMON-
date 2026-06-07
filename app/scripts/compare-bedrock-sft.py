#!/usr/bin/env python3
import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import boto3


SYSTEM = (
    "Voce e o SOLOMON, assistente tecnico para corretores de seguros. "
    "Responda com precisao, separe regras por seguradora/produto e nao invente condicoes."
)


def load_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def ask_bedrock(client, model_id: str, question: str) -> str:
    response = client.converse(
        modelId=model_id,
        system=[{"text": SYSTEM}],
        messages=[{"role": "user", "content": [{"text": question}]}],
        inferenceConfig={"temperature": 0, "maxTokens": 1200},
    )
    return response["output"]["message"]["content"][0]["text"].strip()


def ask_solomon(endpoint: str, token: str, question: str) -> str:
    last_error = None
    for attempt in range(3):
        request = urllib.request.Request(
            endpoint,
            data=json.dumps({"question": question, "evalMode": True, "channel": "api"}).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "X-Eval-Token": token},
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = json.loads(response.read().decode())
            answer = str(data.get("answer") or data.get("data", {}).get("answer") or "").strip()
            if answer:
                return answer
            last_error = RuntimeError("production returned an empty answer")
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as error:
            last_error = error
        time.sleep(2 ** attempt)
    raise RuntimeError(f"production request failed after retries: {last_error}")


def write_jsonl(path: Path, items) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(item, ensure_ascii=False) for item in items) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--questions", required=True, type=Path)
    parser.add_argument("--deployment-arn", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--endpoint", default="https://solomonn.vercel.app/api/ask")
    args = parser.parse_args()

    token = os.environ["SOLOMON_EVAL_TOKEN"]
    bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
    output = load_jsonl(args.out) if args.out.exists() else []
    completed = {item["id"] for item in output}
    for index, item in enumerate(load_jsonl(args.questions), start=1):
        if item["id"] in completed:
            print(f"[{index:02d}] {item['id']} checkpoint", flush=True)
            continue
        started = time.time()
        fine_tuned = ask_bedrock(bedrock, args.deployment_arn, item["question"])
        production = ask_solomon(args.endpoint, token, item["question"])
        output.append({**item, "fine_tuned_answer": fine_tuned, "production_answer": production})
        write_jsonl(args.out, output)
        print(f"[{index:02d}] {item['id']} {time.time() - started:.1f}s", flush=True)

    write_jsonl(args.out, output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
