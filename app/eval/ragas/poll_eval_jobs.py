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

# Whitelist de suites de perguntas + mapping para arquivo jsonl dentro de
# SCRIPT_DIR. O path é SEMPRE resolvido via SCRIPT_DIR / ... — nunca
# aceitamos path absoluto vindo do banco (defesa contra path traversal).
# Para adicionar uma suite nova: (1) arquivo em app/eval/ragas/, (2) entrada
# aqui, (3) entrada equivalente em app/src/app/api/admin/evals/trigger/route.ts
# (whitelist + FIXED_LIMITS) e em app/src/components/admin/eval-trigger.tsx
# (QUESTION_SET_OPTIONS).
QUESTION_SET_WHITELIST = frozenset({"all", "focus5"})
QUESTION_SET_FILES: dict[str, str | None] = {
    "all": None,        # None = deixa run_eval.py usar o default (questions.jsonl)
    "focus5": "questions_focus5.jsonl",
}

# Últimas N linhas do stderr/stdout capturadas em caso de falha
ERROR_TAIL_LINES = 30

# TTL de job órfão: o subprocess tem timeout de 2h; se um job fica em 'running'
# além disto (poller morto por OOM/kill/deploy entre o claim e o patch final),
# ele é reclamado como 'failed' para a fila não travar (o anti-dupla-fila do
# trigger conta requested+running — um órfão eterno = 409 para sempre).
STALE_RUNNING_TTL_SECONDS = 3 * 60 * 60  # 3h (> timeout de 2h do subprocess)


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
    # TLS verificado (default). A service-role key viaja no header Authorization;
    # desabilitar verificacao exporia a chave a MITM na rede da VPS. O hub Supabase
    # tem cert valido. Se um dia houver proxy com cert self-signed, passar o CA via
    # SSL_CERT_FILE/cafile — nunca desligar a verificacao.
    ctx = ssl.create_default_context()
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
    # TLS verificado (default) — ver _http.
    ctx = ssl.create_default_context()
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


def reclaim_stale_jobs() -> int:
    """
    Reclama jobs órfãos: jobs em 'running' cujo updated_at é mais antigo que o
    TTL viram 'failed' com erro de timeout/órfão. Sem isto, um poller morto
    (OOM/kill/deploy) entre o claim e o patch final deixa o job eternamente em
    'running' — e o anti-dupla-fila do trigger (conta requested+running) trava
    a fila com 409 para sempre. Roda no início de cada ciclo do poller.
    Retorna quantos jobs foram reclamados.
    """
    cutoff = time.gmtime(time.time() - STALE_RUNNING_TTL_SECONDS)
    cutoff_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", cutoff)
    params = urllib.parse.urlencode({
        "project": "eq.solomon",
        "status": "eq.running",
        "updated_at": f"lt.{cutoff_iso}",
        "select": "id,updated_at",
    })
    url = _hub_url(f"eval_jobs?{params}")
    status, payload = _http("GET", url)
    if status != 200 or not isinstance(payload, list) or len(payload) == 0:
        return 0

    reclaimed = 0
    for job in payload:
        stale_id = job.get("id")
        if not stale_id:
            continue
        print(f"[poller] job orfao id={stale_id} running desde {job.get('updated_at')!r} — reclamando como failed")
        patch_job(stale_id, {
            "status": "failed",
            "error": f"orfao: preso em 'running' alem do TTL de {STALE_RUNNING_TTL_SECONDS // 3600}h "
                     "(poller provavelmente morreu entre claim e conclusao)",
        })
        reclaimed += 1
    return reclaimed


def validate_params(params: dict[str, Any]) -> tuple[int, str, bool, str] | str:
    """
    Revalida params do job (defesa em profundidade — nunca confiar no banco).
    Retorna (limit, judge, multi_judge, question_set) se OK, ou mensagem de erro se inválido.
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

    question_set = str(params.get("questionSet", "all")).strip().lower()
    if question_set not in QUESTION_SET_WHITELIST:
        return f"questionSet={question_set!r} nao esta na whitelist {sorted(QUESTION_SET_WHITELIST)}"

    return limit, judge, multi_judge, question_set


# Sinais (em stdout/stderr do run_eval) de erro TRANSITÓRIO de API de judge —
# quota/rate/5xx. Por feedback_llm_erro_api_vs_logico.md, esses NÃO são erro
# lógico do matcher; a mensagem persistida deixa isso explícito para que o admin
# saiba que vale re-disparar (re-enfileiro automático fica como dívida — IN/WR-02).
_TRANSIENT_API_SIGNALS = (
    "429",
    "rate limit",
    "rate_limit",
    "ratelimit",
    "too many requests",
    "quota",
    "insufficient_quota",
    "overloaded",
    "503",
    "502",
    "504",
    "service unavailable",
    "timeout",
    "timed out",
    "connection reset",
    "temporarily unavailable",
)


def classify_error(text: str) -> str:
    """
    Classifica o erro do run_eval: 'transitorio' (API/quota/rate/5xx) vs 'logico'.
    Não re-enfileira — só rotula para a UI/audit deixarem claro se vale re-disparar.
    """
    low = text.lower()
    for sig in _TRANSIENT_API_SIGNALS:
        if sig in low:
            return "transitorio"
    return "logico"


def run_eval(limit: int, judge: str, multi_judge: bool, question_set: str = "all", dry_run: bool = False) -> tuple[int, str, str]:
    """
    Executa run_eval.py como subprocesso com params validados.
    Retorna (exit_code, run_id_capturado, error_msg).
    run_id é o timestamp gerado pelo run_eval ('YYYYMMDD_HHMMSS').

    question_set (2026-06-24): "all" (default, legacy) usa questions.jsonl
    do run_eval.py. Outras suites (ex: "focus5") passam --questions com path
    resolvido dentro de SCRIPT_DIR — nunca aceita path externo.
    """
    python = str(SCRIPT_DIR / ".venv" / "bin" / "python")
    if not Path(python).exists():
        # Fallback: python do PATH (ex: quando o .venv ainda não existe)
        python = sys.executable

    run_eval_path = str(SCRIPT_DIR / "run_eval.py")

    # Comando fixo — params passados como argumentos tipados, nunca interpolados
    cmd = [python, run_eval_path, "--limit", str(limit)]

    # --questions: apenas se a suite tem arquivo mapeado (whitelist).
    # Path resolvido via SCRIPT_DIR — defesa contra path traversal.
    questions_file = QUESTION_SET_FILES.get(question_set)
    if questions_file is not None:
        cmd.extend(["--questions", str(SCRIPT_DIR / questions_file)])

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
        return 1, "", "[transitorio: subprocess excedeu 2h — vale re-disparar] timeout apos 2h"
    except Exception as exc:
        return 1, "", f"[erro] ao iniciar processo: {exc}"

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
        kind = classify_error(tail)
        if kind == "transitorio":
            prefix = ("[transitorio: erro de API de judge (rate/quota/5xx) — "
                      "NAO e erro logico do matcher; vale re-disparar] ")
        else:
            prefix = "[erro] "
        return result.returncode, run_id, prefix + tail

    return 0, run_id, ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Poller VPS para jobs de eval Ragas")
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que faria, nao executa run_eval.py")
    args = parser.parse_args()

    print(f"[poller] iniciando — {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")

    # 0. Reclamar jobs órfãos antes de tudo — destrava a fila se um poller morreu
    #    no meio (job preso em 'running' faz o trigger retornar 409 pra sempre).
    try:
        reclaimed = reclaim_stale_jobs()
        if reclaimed:
            print(f"[poller] {reclaimed} job(s) orfao(s) reclamado(s) como failed")
    except RuntimeError as e:
        print(f"[poller] ERRO configuracao: {e}")
        return 1

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

    limit, judge, multi_judge, question_set = validation
    print(f"[poller] params validados: limit={limit} judge={judge} multi_judge={multi_judge} question_set={question_set}")

    # 4. Executar run_eval.py
    exit_code, run_id, error_msg = run_eval(limit, judge, multi_judge, question_set, dry_run=args.dry_run)

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
