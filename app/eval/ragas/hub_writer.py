"""
Escreve resultados per-question do Ragas no agentes-hub Supabase.

Dispara um INSERT por pergunta na tabela `eval_runs` (project=solomon).
Permite querys SQL como:
  SELECT question_id, faithfulness FROM eval_runs
  WHERE category='comparison' AND created_at > now() - interval '7 days'
  ORDER BY run_id DESC, faithfulness ASC;

Env vars (ja existem em /root/agents/config/.env na VPS):
    MANAGED_SUPABASE_URL   — URL do projeto agentes-hub
    MANAGED_SUPABASE_KEY   — service role key

Modo defensivo: falha silenciosa nao aborta o eval. Eval e o trabalho real;
hub e observabilidade.
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from typing import Any, Iterable

REST_PATH = "/rest/v1/eval_runs"
BATCH_SIZE = 25  # PostgREST aguenta bem mais; 25 e conservador


def _hub_env() -> tuple[str, str] | None:
    url = os.environ.get("MANAGED_SUPABASE_URL")
    key = os.environ.get("MANAGED_SUPABASE_KEY")
    if not url or not key:
        return None
    return url.rstrip("/"), key


def _post_batch(url: str, key: str, rows: list[dict[str, Any]]) -> tuple[bool, str]:
    body = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url + REST_PATH,
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
            return (200 <= r.status < 300), f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return False, f"HTTP {e.code}: {raw[:200]}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def _row_for_question(
    record: dict[str, Any],
    score_row: dict[str, Any] | None,
    *,
    run_id: str,
    judge_backend: str,
    judge_model: str,
    divergence: dict[str, Any] | None = None,
    divergence_judge_b: str | None = None,
) -> dict[str, Any]:
    """Monta payload de 1 linha eval_runs a partir de record (raw.jsonl) +
    linha do dataframe Ragas (ja convertida pra dict)."""
    response = record.get("response") or {}
    data = response.get("data") or {}
    sources = data.get("sources") or []
    insurer_ids = sorted({
        str(s.get("insurer_id") or s.get("insurerId") or "")
        for s in sources
        if s.get("insurer_id") or s.get("insurerId")
    })
    chunk_ids = [
        s.get("chunk_id") or s.get("id")
        for s in sources
        if s.get("chunk_id") or s.get("id")
    ][:50]  # limita a 50 pra payload nao explodir

    def _num(*keys: str) -> float | None:
        """Le primeiro key disponivel no score_row. Util porque Ragas 0.2.x
        nomeia algumas metricas com sufixo (ex: 'noise_sensitivity(mode=relevant)')."""
        if not score_row:
            return None
        for key in keys:
            v = score_row.get(key)
            if v is None:
                continue
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            if f != f:  # NaN
                continue
            return f
        return None

    return {
        "project": "solomon",
        "run_id": run_id,
        "question_id": record["id"],
        "category": record.get("category") or "unknown",
        "question": record.get("question"),
        "ground_truth": record.get("ground_truth"),
        "answer": data.get("answer"),
        "model": data.get("model"),
        "faithfulness": _num("faithfulness"),
        "answer_correctness": _num("answer_correctness"),
        "context_precision": _num("context_precision"),
        "context_recall": _num("context_recall"),
        "noise_sensitivity": _num(
            "noise_sensitivity",
            "noise_sensitivity(mode=relevant)",
            "noise_sensitivity_relevant",
        ),
        "retrieved_chunk_count": len(sources) or None,
        "retrieved_insurer_ids": insurer_ids or None,
        "retrieved_chunk_ids": chunk_ids or None,
        "latency_ms": data.get("latencyMs"),
        "judge_backend": judge_backend,
        "judge_model": judge_model,
        "divergence_flag": bool(divergence),
        "divergence_metric": divergence.get("metric") if divergence else None,
        "divergence_delta": divergence.get("delta") if divergence else None,
        "divergence_judge_b": divergence_judge_b if divergence else None,
        "metadata": {
            "endpoint_ok": bool(response.get("ok")),
            "endpoint_status": response.get("status"),
            "expected_model": record.get("expected_model"),
            "expected_insurers": record.get("expected_insurers"),
        },
    }


def write_eval_runs(
    records: list[dict[str, Any]],
    score_rows: list[dict[str, Any]],
    *,
    run_id: str,
    judge_backend: str,
    judge_model: str,
    divergences: dict[str, dict[str, Any]] | None = None,
    divergence_judge_b: str | None = None,
) -> dict[str, Any]:
    """Escreve N linhas (1 por pergunta) na eval_runs.

    Args:
      records: lista do raw.jsonl (cada um com id, category, question, ground_truth, response).
      score_rows: lista de dicts vinda de df_ragas.to_dict('records'), 1 por pergunta com colunas
                  faithfulness, answer_correctness, context_precision, context_recall, noise_sensitivity.
                  Tem que ter ID via coluna 'id' pra fazer join.
      run_id: timestamp do diretorio results.
      divergences: opcional, dict {qid: {metric, delta}} de compute_divergence().
      divergence_judge_b: nome do judge secundario (ex: 'anthropic') quando multi-judge.

    Returns:
      {ok: bool, sent: int, failed: int, error: str|None}
    """
    env = _hub_env()
    if not env:
        return {"ok": False, "sent": 0, "failed": 0, "error": "MANAGED_SUPABASE_URL/KEY ausentes"}
    url, key = env

    divergences = divergences or {}

    # Ragas 0.2.x dropa colunas extras do dataset (id, category) — score_rows[i]
    # casa por POSICAO com a i-esima pergunta valida (mesmos filtros do
    # build_ragas_dataset: response.ok=True E out_of_scope!=True).
    eligible = [
        r for r in records
        if r.get("response", {}).get("ok") and r.get("out_of_scope") is not True
    ]
    if len(eligible) != len(score_rows):
        return {
            "ok": False, "sent": 0, "failed": 0,
            "error": f"join por indice falhou: {len(eligible)} eligible vs {len(score_rows)} score_rows",
        }

    payload: list[dict[str, Any]] = []
    for r, sr in zip(eligible, score_rows):
        payload.append(
            _row_for_question(
                r, sr,
                run_id=run_id,
                judge_backend=judge_backend,
                judge_model=judge_model,
                divergence=divergences.get(r["id"]),
                divergence_judge_b=divergence_judge_b,
            )
        )

    sent = 0
    failed = 0
    last_err: str | None = None
    for i in range(0, len(payload), BATCH_SIZE):
        batch = payload[i : i + BATCH_SIZE]
        ok, msg = _post_batch(url, key, batch)
        if ok:
            sent += len(batch)
        else:
            failed += len(batch)
            last_err = msg

    return {"ok": failed == 0, "sent": sent, "failed": failed, "error": last_err}
