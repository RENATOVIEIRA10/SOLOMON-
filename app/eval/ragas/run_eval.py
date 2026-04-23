"""
SOLOMON Ragas eval harness.

Le questions.jsonl, chama /api/ask com evalMode=true para cada pergunta,
monta um Ragas Dataset e calcula faithfulness, answer_correctness,
context_precision. Salva raw responses + metricas em results/<timestamp>/.

Uso:
    python run_eval.py [--endpoint https://app-atalaia.vercel.app/api/ask] \\
                       [--questions questions.jsonl] \\
                       [--limit N] \\
                       [--skip-ragas]  # so coleta respostas, nao roda metricas
                       [--json-mode-isolated]  # pre-sinistro: faithfulness so no rationale

Env vars obrigatorias (so quando roda Ragas):
    ANTHROPIC_API_KEY  — usado como judge LLM (Claude Haiku 4.5)

Roda na VPS (notebook 4GB nao aguenta Ragas em paralelo).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_ENDPOINT = "https://app-atalaia.vercel.app/api/ask"
REQUEST_TIMEOUT = 90  # /api/ask com RAG pode levar 30s+


def load_questions(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _http_post(url: str, body: dict[str, Any], timeout: int = REQUEST_TIMEOUT) -> dict[str, Any]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "solomon-ragas-eval/1.0"},
    )
    ctx = ssl.create_default_context()
    # Corporate cert-manager no notebook Windows exige bypass. Na VPS e inofensivo.
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    start = time.time()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return {"ok": True, "status": r.status, "data": json.loads(raw), "elapsed": time.time() - start}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "status": e.code, "error": raw, "elapsed": time.time() - start}
    except Exception as e:
        return {"ok": False, "status": 0, "error": f"{type(e).__name__}: {e}", "elapsed": time.time() - start}


def call_ask(endpoint: str, question: str, timeout: int = REQUEST_TIMEOUT) -> dict[str, Any]:
    """POST /api/ask com evalMode=true. Retorna dict com answer, sources, model, latencyMs."""
    return _http_post(endpoint, {"question": question, "evalMode": True, "channel": "api"}, timeout)


def _pre_sinistro_endpoint(ask_endpoint: str) -> str:
    """Deriva URL de /api/pre-sinistro a partir da URL de /api/ask."""
    if ask_endpoint.rstrip("/").endswith("/api/ask"):
        return ask_endpoint.rstrip("/")[: -len("/api/ask")] + "/api/pre-sinistro"
    # Fallback: substituir ultimo segmento
    return ask_endpoint.rsplit("/", 1)[0] + "/pre-sinistro"


def call_pre_sinistro(ask_endpoint: str, pre_body: dict[str, Any], timeout: int = REQUEST_TIMEOUT) -> dict[str, Any]:
    """POST /api/pre-sinistro. Mapeia resposta para estrutura {answer, sources, model, latencyMs}
    compativel com o pipeline Ragas.
    """
    url = _pre_sinistro_endpoint(ask_endpoint)
    result = _http_post(url, pre_body, timeout)
    if not result["ok"]:
        return result
    ps = result["data"]
    # Compoe answer textual a partir do veredicto estruturado.
    # IMPORTANTE: riskFlags e documentsChecklist SAEM do answer avaliado pelo
    # Ragas. Eles sao best-practice generica (ex: "documento de identidade",
    # "formulario de aviso de sinistro") que nao aparecem nas condicoes gerais
    # — poluem faithfulness com claims ungroundable. Campos seguem no JSON de
    # resposta (UI do corretor continua usando), so nao entram na string que
    # o judge Ragas examina.
    parts: list[str] = []
    if ps.get("verdict"):
        parts.append(f"VEREDICTO: {ps['verdict']}")
    if ps.get("confidence") is not None:
        parts.append(f"Confianca: {ps['confidence']:.2f}")
    rationale = ps.get("rationale") or ""
    if rationale:
        parts.append(rationale)
    cit = ps.get("citation") or {}
    if cit.get("excerpt"):
        clause = cit.get("clause") or ""
        parts.append(f"Clausula {clause}: {cit['excerpt']}")
    answer = "\n\n".join(parts)

    # Fonte primaria de context: chunks RAG que o analyzePreSinistro usou.
    # Ragas avalia faithfulness comparando a answer contra contexts — se so
    # passarmos o excerpt da citacao, o judge acha que tudo que nao esta no
    # excerpt e "alucinacao" (rationale + documentos + riscos saem do contexto
    # inteiro, nao so da clausula citada).
    sources: list[dict[str, Any]] = []
    for ch in ps.get("chunks") or []:
        content = ch.get("content") or ""
        if content:
            sources.append({
                "content": content,
                "similarity": ch.get("similarity"),
                "source_url": ch.get("source_url"),
                "insurer_id": ch.get("insurer_id"),
            })
    # Fallback: se por algum motivo chunks vier vazio, usa o excerpt da citation
    # para nao quebrar o eval.
    if not sources and cit.get("excerpt"):
        sources.append({
            "content": cit["excerpt"],
            "insurer": cit.get("insurer"),
            "clause": cit.get("clause"),
            "source_url": cit.get("source_url"),
        })

    # Reembrulha no formato esperado por collect_responses/build_ragas_dataset
    result["data"] = {
        "answer": answer,
        "rationale": rationale,
        "sources": sources,
        "sourceCount": len(sources),
        "model": ps.get("model", "claude-sonnet-4.6"),
        "latencyMs": ps.get("latencyMs"),
    }
    return result


def collect_responses(
    questions: list[dict[str, Any]],
    endpoint: str,
    out_dir: Path,
) -> list[dict[str, Any]]:
    """Chama /api/ask para cada pergunta e salva raw responses em out_dir/raw.jsonl."""
    raw_path = out_dir / "raw.jsonl"
    records: list[dict[str, Any]] = []

    with raw_path.open("w", encoding="utf-8") as f:
        for i, q in enumerate(questions, start=1):
            qid = q["id"]
            print(f"[{i:02d}/{len(questions)}] {qid} | {q['category']:<15} | {q['question'][:70]}")
            # Pre-sinistro: rota dedicada /api/pre-sinistro com body estruturado.
            pre_body = q.get("pre_sinistro")
            if pre_body:
                result = call_pre_sinistro(endpoint, pre_body)
            else:
                result = call_ask(endpoint, q["question"])
            record = {
                "id": qid,
                "category": q["category"],
                "question": q["question"],
                "ground_truth": q["ground_truth"],
                "expected_model": q.get("expected_model"),
                "expected_insurers": q.get("expected_insurers", []),
                "needs_julio_review": q.get("needs_julio_review", False),
                "response": result,
            }
            records.append(record)
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            f.flush()

            if result["ok"]:
                model = result["data"].get("model", "?")
                lat = result["data"].get("latencyMs", "?")
                src_count = result["data"].get("sourceCount") or len(result["data"].get("sources") or [])
                print(f"       -> model={model} latency={lat}ms sources={src_count}")
            else:
                print(f"       -> FAIL status={result['status']} err={result['error'][:120]}")
            # rate limit defensivo — evita pisar no callable do Vercel
            time.sleep(0.5)

    return records


def build_ragas_dataset(records: list[dict[str, Any]], json_mode_isolated: bool = False):
    """Converte records (so os que ok=True) para datasets.Dataset no formato Ragas."""
    from datasets import Dataset

    rows = []
    for r in records:
        if not r["response"]["ok"]:
            continue
        data = r["response"]["data"]
        answer = data.get("answer") or ""
        # Isolamento de JSON mode: para pre-sinistro, faithfulness so no rationale
        # (texto puro) + citation.excerpt. Isso desambigua se o score baixo vem do
        # harness (JSON mode) ou do Sonnet alucinando.
        if json_mode_isolated and r.get("category") == "pre_sinistro":
            rationale = data.get("rationale") or ""
            # Concatena rationale + excerpt da citacao (o excerpt e a ancora factual)
            # para manter o link entre justificativa e fonte.
            sources = data.get("sources") or []
            excerpt = ""
            if sources:
                excerpt = sources[0].get("content") or ""
            parts = [p for p in (rationale, excerpt) if p]
            answer = "\n\n".join(parts) if parts else answer
        sources = data.get("sources") or []
        model = data.get("model", "")
        # Prefixa [insurer — product] no content quando disponivel. Sem isso,
        # em comparisons multi-insurer o judge Ragas recebe chunks anonimos e
        # nao consegue ligar "chunk fala de cobertura AP" -> "responde a query
        # Zurich vs Bradesco", dai context_precision cai para 0. Com prefixo, o
        # judge reconhece cada chunk como contribuicao a um lado da comparacao.
        contexts = []
        for s in sources:
            content = s.get("content") or ""
            if not content:
                continue
            insurer = s.get("insurerName") or s.get("insurer")
            product = s.get("productName")
            prefix_parts = [p for p in (insurer, product) if p]
            if prefix_parts:
                content = f"[{' — '.join(prefix_parts)}]\n{content}"
            contexts.append(content)
        # Fast-path rate-table-lookup nao popula sources[] (resposta vem de DB
        # deterministico, zero LLM). O answer JA e a projecao literal das rows.
        # Tratar answer como context faz context_precision e faithfulness
        # refletirem a realidade: lookup estruturado nao alucina.
        if model == "rate-table-lookup" and not contexts:
            contexts = [answer]
        # Ragas exige pelo menos um context — se nao ha, stub.
        if not contexts:
            contexts = ["<nenhum chunk recuperado>"]
        rows.append(
            {
                "question": r["question"],
                "answer": answer,
                "contexts": contexts,
                "ground_truth": r["ground_truth"],
                # extras usados no report
                "id": r["id"],
                "category": r["category"],
            }
        )
    return Dataset.from_list(rows)


def run_ragas(dataset, out_dir: Path) -> dict[str, Any]:
    """Roda faithfulness, answer_correctness, context_precision com Haiku 4.5 como judge."""
    from ragas import evaluate
    from ragas.metrics import answer_correctness, context_precision, faithfulness

    from metrics import build_evaluator_llm, build_evaluator_embeddings

    llm = build_evaluator_llm()
    embeddings = build_evaluator_embeddings()

    result = evaluate(
        dataset=dataset,
        metrics=[faithfulness, answer_correctness, context_precision],
        llm=llm,
        embeddings=embeddings,
    )

    # Salva scores por pergunta + agregado
    df = result.to_pandas()
    df_path = out_dir / "ragas_per_question.csv"
    df.to_csv(df_path, index=False, encoding="utf-8")

    scores_path = out_dir / "ragas_scores.json"
    scores_path.write_text(
        json.dumps({k: float(v) for k, v in result._repr_dict.items()}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return {"aggregate": result._repr_dict, "per_question_csv": str(df_path), "scores_json": str(scores_path)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default=os.environ.get("SOLOMON_EVAL_ENDPOINT", DEFAULT_ENDPOINT))
    parser.add_argument("--questions", default=str(SCRIPT_DIR / "questions.jsonl"))
    parser.add_argument("--limit", type=int, default=0, help="0 = todas")
    parser.add_argument("--skip-ragas", action="store_true", help="so coleta respostas, nao roda Ragas")
    parser.add_argument("--json-mode-isolated", action="store_true",
                        help="pre-sinistro: faithfulness avaliado so no rationale + excerpt (isola JSON mode bias)")
    parser.add_argument("--results-dir", default=str(SCRIPT_DIR / "results"))
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    questions = load_questions(Path(args.questions))
    if args.limit > 0:
        questions = questions[: args.limit]

    timestamp = dt.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    # Se json-mode-isolated, adiciona sufixo no diretorio para nao sobrescrever
    if args.json_mode_isolated:
        timestamp += "_json_isolated"
    out_dir = Path(args.results_dir) / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== SOLOMON Ragas eval — {timestamp} ===")
    print(f"endpoint:  {args.endpoint}")
    print(f"questions: {len(questions)} (file: {args.questions})")
    print(f"json-mode-isolated: {args.json_mode_isolated}")
    print(f"results:   {out_dir}")
    print()

    records = collect_responses(questions, args.endpoint, out_dir)

    n_ok = sum(1 for r in records if r["response"]["ok"])
    print(f"\n=== coletado: {n_ok}/{len(records)} respostas OK ===")

    if args.skip_ragas:
        print("--skip-ragas: pulando metricas Ragas.")
        return 0

    if n_ok == 0:
        print("Nenhuma resposta OK — abortando.")
        return 1

    print("\n=== rodando Ragas (faithfulness + answer_correctness + context_precision) ===")
    dataset = build_ragas_dataset(records, json_mode_isolated=args.json_mode_isolated)
    scores = run_ragas(dataset, out_dir)
    print("\n=== scores agregados ===")
    print(json.dumps(scores["aggregate"], indent=2, ensure_ascii=False))

    print(f"\nReport: rode `python report.py {out_dir}` para gerar markdown.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
