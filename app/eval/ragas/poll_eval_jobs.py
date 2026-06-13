"""
poll_eval_jobs.py — Poller VPS para disparo de evals Ragas.

Roda a cada 5 min via cron na VPS. Busca 1 job 'requested' no agentes-hub,
faz claim atômico, executa run_eval.py e atualiza o status.

SEGURANÇA (defesa em profundidade):
  - Os params (limit, judge) vêm do banco, que por sua vez vieram da API
    validada. Mas o poller AINDA assim revalida tudo antes de executar —
    nunca confiar em input externo, mesmo que venha do próprio banco.
  - Nada de interpolação de string livre em comandos: limit é int, judge é
    da whitelist, e o comando é montado como lista (subprocess.run sem shell=True).
  - Job malformado é marcado como 'failed' sem executar.

Uso:
    python poll_eval_jobs.py [--dry-run]  # --dry-run: mostra o que faria, nao executa

Env (lidos de /root/agents/config/.env ou exportados antes de chamar):
    MANAGED_SUPABASE_URL   — URL do agentes-hub
    MANAGED_SUPABASE_KEY   — service role key do agentes-hub
    (+ as envs que run_eval.py precisa: ANTHROPIC_API_KEY, GEMINI_API_KEY, etc.)

Crontab (instalar na VPS, ver docs/ops/eval-trigger-queue.md):
    */5 * * * * /root/solomon/repo/app/eval/ragas/.venv/bin/python /root/solomon/repo/app/eval/ragas/poll_eval_jobs.py >> /var/log/solomon-eval-poller.log 2>&1
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

# Whitelist de valores aceitos — imutável, não vem do banco
JUDGE_WHITELIST = frozenset({"openai", "gemini", "anthropic"})
LIMIT_MIN = 1
LIMIT_MAX = 50

# Últimas N linhas do stderr/stdout capturadas em caso de falha
ERROR_TAIL_LINES = 30


def _hub_headers() -> dict[str, str]:
    key = os.environ.get("MANAGED_SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError("MANAGED_SUPABASE_KEY ou SUPABASE_SERVICE_ROLE_KEY nao definido")
    return {
        "Content-Type": "application/json",
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Prefer": "return=representation",
    }


def _hub_url(path: str) -> str:
    base = (
        os.environ.get("MANAGED_SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or ""
    ).rstrip("/")
    if not base:
        raise RuntimeError("MANAGED_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_URL nao definido")
    return f"{base}/rest/v1/{path.lstrip('/')}"


def _http(method: str, url: str, body: dict[str, Any] | None = None, timeout: int = 20) -> tuple[int, Any]:
    """Faz request HTTP simples via urllib (stdlib, sem deps extras)."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=_hub_headers())
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            payload = json.loads(raw) if raw.strip() else None
            return r.status, payload
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return e.code, raw


def fetch_oldest_requested() -> dict[str, Any] | None:
    """Busca 1 job 'requested' mais antigo (project=solomon)."""
    params = urllib.parse.urlencode({
        "project": "eq.solomon",
        "status": "eq.requested",
        "order": "created_at.asc",
        "limit": "1",
    })
    url = _hub_url(f"eval_jobs?{params}")
    status, payload = _http("GET", url)
    if status != 200 or not isinstance(payload, list) or len(payload) == 0:
        return None
    return payload[0]


def claim_job(job_id: str) -> bool:
    """
    Claim atômico: PATCH status='running' WHERE id=X AND status='requested'.
    Retorna True se a linha foi atualizada (0 linhas = outro poller pegou primeiro).
    """
    params = urllib.parse.urlencode({
        "id": f"eq.{job_id}",
        "status": "eq.requested",  # cláusula extra — evita corrida entre instâncias
    })
    url = _hub_url(f"eval_jobs?{params}")
    # Prefer: return=representation + count=exact para detectar 0 linhas afetadas
    headers_extra = {"Prefer": "return=representation,count=exact"}
    data = json.dumps({"status": "running"}).encode()
    req = urllib.request.Request(url, data=data, method="PATCH", headers={**_hub_headers(), **headers_extra})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
            raw = r.read().decode("utf-8")
            rows = json.loads(raw) if raw.strip() else []
            return isinstance(rows, list) and len(rows) > 0
    except urllib.error.HTTPError as e:
        e.read()
        return False


def patch_job(job_id: str, fields: dict[str, Any]) -> None:
    """Atualiza campos do job (status, run_id, error)."""
    params = urllib.parse.urlencode({"id": f"eq.{job_id}"})
    url = _hub_url(f"eval_jobs?{params}")
    _http("PATCH", url, fields)


def validate_params(params: dict[str, Any]) -> tuple[int, str, bool] | str:
    """
    Revalida params do job (defesa em profundidade — nunca confiar no banco).
    Retorna (limit, judge, multi_judge) se OK, ou mensagem de erro se inválido.
    """
    try:
        limit = int(params.get("limit", 0))
    except (TypeError, ValueError):
        return "limit nao e inteiro"
    if limit < LIMIT_MIN or limit > LIMIT_MAX:
        return f"limit={limit} fora do intervalo {LIMIT_MIN}..{LIMIT_MAX}"

    judge = str(params.get("judge", "")).strip().lower()
    if judge not in JUDGE_WHITELIST:
        return f"judge={judge!r} nao esta na whitelist {sorted(JUDGE_WHITELIST)}"

    multi_judge = bool(params.get("multiJudge", False))

    return limit, judge, multi_judge


def run_eval(limit: int, judge: str, multi_judge: bool, dry_run: bool = False) -> tuple[int, str, str]:
    """
    Executa run_eval.py como subprocesso com params validados.
    Retorna (exit_code, run_id_capturado, error_msg).
    run_id é o timestamp gerado pelo run_eval ('YYYYMMDD_HHMMSS').
    """
    python = str(SCRIPT_DIR / ".venv" / "bin" / "python")
    if not Path(python).exists():
        # Fallback: python do PATH (ex: quando o .venv ainda não existe)
        python = sys.executable

    run_eval_path = str(SCRIPT_DIR / "run_eval.py")

    # Comando fixo — params passados como argumentos tipados, nunca interpolados
    cmd = [python, run_eval_path, "--limit", str(limit)]
    if multi_judge:
        cmd.append("--multi-judge")

    # JUDGE_BACKEND é passado via env (run_eval.py lê os.environ["JUDGE_BACKEND"])
    env = os.environ.copy()
    env["JUDGE_BACKEND"] = judge

    print(f"[poller] cmd={cmd} env.JUDGE_BACKEND={judge}")
    if dry_run:
        print("[poller] --dry-run: nao executando")
        return 0, f"dryrun_{int(time.time())}", ""

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(SCRIPT_DIR),
            env=env,
            timeout=7200,  # 2h máximo (full 49q pode demorar)
        )
    except subprocess.TimeoutExpired:
        return 1, "", "timeout apos 2h"
    except Exception as exc:
        return 1, "", f"erro ao iniciar processo: {exc}"

    stdout = result.stdout or ""
    stderr = result.stderr or ""
    combined = (stdout + "\n" + stderr).strip()

    # Extrair run_id da linha "=== SOLOMON Ragas eval — TIMESTAMP ==="
    run_id = ""
    for line in stdout.splitlines():
        if "SOLOMON Ragas eval" in line and "—" in line:
            # Formato: "=== SOLOMON Ragas eval — 20260613_120000 ==="
            parts = line.split("—")
            if len(parts) >= 2:
                candidate = parts[-1].strip().strip("=").strip()
                # Validar formato básico YYYYMMDD_HHMMSS (pode ter sufixo)
                if len(candidate) >= 15 and candidate[:8].isdigit() and candidate[8] == "_":
                    run_id = candidate
            break

    if result.returncode != 0:
        tail = "\n".join(combined.splitlines()[-ERROR_TAIL_LINES:])
        return result.returncode, run_id, tail

    return 0, run_id, ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Poller VPS para jobs de eval Ragas")
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que faria, nao executa run_eval.py")
    args = parser.parse_args()

    print(f"[poller] iniciando — {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")

    # 1. Buscar job mais antigo com status 'requested'
    try:
        job = fetch_oldest_requested()
    except RuntimeError as e:
        print(f"[poller] ERRO configuracao: {e}")
        return 1

    if job is None:
        print("[poller] nenhum job 'requested' — saindo")
        return 0

    job_id = job["id"]
    params = job.get("params") or {}
    print(f"[poller] job encontrado id={job_id} params={params}")

    # 2. Claim atômico — evita corrida entre instâncias do poller
    if not claim_job(job_id):
        print(f"[poller] job {job_id} ja foi pego por outro poller — saindo")
        return 0

    print(f"[poller] claim OK — status=running")

    # 3. Revalidar params (defesa em profundidade — nunca confiar no banco)
    validation = validate_params(params)
    if isinstance(validation, str):
        error_msg = f"params invalidos: {validation}"
        print(f"[poller] ERRO {error_msg}")
        patch_job(job_id, {"status": "failed", "error": error_msg})
        return 1

    limit, judge, multi_judge = validation
    print(f"[poller] params validados: limit={limit} judge={judge} multi_judge={multi_judge}")

    # 4. Executar run_eval.py
    exit_code, run_id, error_msg = run_eval(limit, judge, multi_judge, dry_run=args.dry_run)

    # 5. Atualizar status no banco
    if exit_code == 0:
        print(f"[poller] run_eval concluiu OK — run_id={run_id!r}")
        patch_job(job_id, {"status": "done", "run_id": run_id or None})
    else:
        print(f"[poller] run_eval FALHOU exit={exit_code} — error={error_msg[:200]!r}")
        patch_job(job_id, {"status": "failed", "run_id": run_id or None, "error": error_msg[:2000]})
        return 1

    print(f"[poller] concluido — {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
