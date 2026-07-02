"use client";

/**
 * EvalTrigger — painel de disparo de eval Ragas pela web.
 *
 * Ações:
 *   1. POST /api/admin/evals/trigger com { limit, judge, multiJudge, questionSet }
 *   2. Ao receber 201, inicia polling GET /api/admin/evals/jobs a cada 8s
 *   3. Exibe status do job ativo: requested → running → done/failed
 *   4. Para o polling quando status done/failed
 *
 * questionSet (2026-06-24):
 *   - "all"    → suite legado (49 perguntas), limit variável (3 smoke / 49 full)
 *   - "focus5" → subset comercial ativo (Azos, Prudential, Icatu, MAG, MetLife),
 *                limit fixo em 26 (= total do questions_focus5.jsonl).
 *                Referência: docs/qa/focus5-baseline-2026-06-23.md
 *
 * Estética SOLOMON: gold, mono-tag, sem azul, sem emoji estrutural.
 * Ícones via lucide-react.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Play, RefreshCw, CheckCircle2, XCircle, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Judge = "openai" | "gemini" | "anthropic";
type QuestionSet = "all" | "focus5";
type JobStatus = "requested" | "running" | "done" | "failed";

interface EvalJob {
  id: string;
  status: JobStatus;
  params: {
    limit: number;
    judge: Judge;
    multiJudge: boolean;
    questionSet?: QuestionSet;
  };
  requested_by: string;
  run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// Suites com limit fixo travam o select de limit (suite É a unidade de
// comparação apples-to-apples com o baseline). Suites variáveis deixam o
// usuário escolher smoke/full.
const QUESTION_SET_OPTIONS: {
  value: QuestionSet;
  label: string;
  fixedLimit: number | null;
}[] = [
  { value: "all", label: "Todas (49)", fixedLimit: null },
  { value: "focus5", label: "Focus5 (26)", fixedLimit: 26 },
];

const LIMIT_OPTIONS = [
  { value: 3, label: "3 — smoke" },
  { value: 49, label: "49 — full" },
];

const JUDGE_OPTIONS: { value: Judge; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "anthropic", label: "Anthropic" },
];

function statusIcon(status: JobStatus) {
  switch (status) {
    case "requested":
      return <RefreshCw className="w-3.5 h-3.5 animate-spin text-warning" />;
    case "running":
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-info" />;
    case "done":
      return <CheckCircle2 className="w-3.5 h-3.5 text-success" />;
    case "failed":
      return <XCircle className="w-3.5 h-3.5 text-danger" />;
  }
}

function statusLabel(status: JobStatus) {
  const MAP: Record<JobStatus, string> = {
    requested: "Na fila",
    running: "Executando",
    done: "Concluído",
    failed: "Falhou",
  };
  return MAP[status];
}

function formatRelative(iso: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s atrás`;
    if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
    return `${Math.floor(diff / 3600)}h atrás`;
  } catch {
    return iso;
  }
}

export function EvalTrigger() {
  const [questionSet, setQuestionSet] = useState<QuestionSet>("all");
  const [limit, setLimit] = useState<number>(3);
  const [judge, setJudge] = useState<Judge>("openai");
  const [multiJudge, setMultiJudge] = useState<boolean>(false);

  const [firing, setFiring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeJob, setActiveJob] = useState<EvalJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<EvalJob[]>([]);
  const [polling, setPolling] = useState(false);

  // Resolve o limit efetivo (fixo pela suite OU variável pelo usuário)
  const fixedLimit =
    QUESTION_SET_OPTIONS.find((o) => o.value === questionSet)?.fixedLimit ?? null;

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setPolling(false);
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/evals/jobs");
      if (!res.ok) return;
      const jobs: EvalJob[] = await res.json();
      setRecentJobs(jobs);

      const active = jobs.find((j) => j.status === "requested" || j.status === "running");
      setActiveJob(active ?? null);

      if (!active) {
        stopPolling();
      }
    } catch {
      // silencioso — continuará na próxima iteração
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    setPolling(true);
    fetchJobs();
    pollingRef.current = setInterval(fetchJobs, 8000);
  }, [fetchJobs]);

  // Limpar polling ao desmontar
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Buscar jobs iniciais ao montar
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleFire = async () => {
    setFiring(true);
    setError(null);
    try {
      // Se a suite tem limit fixo (focus5), usar ele. Senão, o estado do usuário.
      // Garante que nunca enviamos limit incompatível com a suite.
      const effectiveLimit = fixedLimit ?? limit;
      const res = await fetch("/api/admin/evals/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: effectiveLimit,
          judge,
          multiJudge,
          questionSet,
        }),
      });

      if (res.status === 409) {
        const body = await res.json();
        setError(body.error ?? "Já existe job ativo.");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Erro ${res.status}`);
        return;
      }

      // Job enfileirado — iniciar polling
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setFiring(false);
    }
  };

  const hasActive = activeJob !== null;
  const canFire = !firing && !hasActive;

  return (
    <div className="border border-edge rounded-lg bg-surface-2/40 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="font-mono text-[10px] tracking-widest text-brand/50 uppercase">
            eval / disparo
          </span>
          <h2 className="text-sm font-semibold text-ink">
            Disparar avaliação Ragas
          </h2>
        </div>
        {polling && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-brand/60">
            <Loader2 className="w-3 h-3 animate-spin" />
            polling
          </span>
        )}
      </div>

      {/* Controles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Suite */}
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-ink-muted/60 uppercase">
            Suite
          </label>
          <div className="relative">
            <select
              value={questionSet}
              onChange={(e) => {
                const next = e.target.value as QuestionSet;
                setQuestionSet(next);
                // Ao trocar pra suite com limit fixo, sincroniza o state
                // de limit pro valor fixo (UX: não muta o input, só atualiza).
                const fixed = QUESTION_SET_OPTIONS.find((o) => o.value === next)?.fixedLimit;
                if (fixed !== null && fixed !== undefined) setLimit(fixed);
              }}
              disabled={!canFire}
              className={cn(
                "w-full appearance-none bg-surface-2 border border-edge rounded px-3 py-2",
                "text-xs text-ink font-mono",
                "focus:outline-none focus:border-brand/50",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {QUESTION_SET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 w-3 h-3 text-brand/40" />
          </div>
        </div>

        {/* Limit */}
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-ink-muted/60 uppercase">
            Questões
          </label>
          <div className="relative">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={!canFire || fixedLimit !== null}
              className={cn(
                "w-full appearance-none bg-surface-2 border border-edge rounded px-3 py-2",
                "text-xs text-ink font-mono",
                "focus:outline-none focus:border-brand/50",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {(fixedLimit !== null
                ? [{ value: fixedLimit, label: `${fixedLimit} — suite` }]
                : LIMIT_OPTIONS
              ).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 w-3 h-3 text-brand/40" />
          </div>
        </div>

        {/* Judge */}
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-ink-muted/60 uppercase">
            Judge
          </label>
          <div className="relative">
            <select
              value={judge}
              onChange={(e) => setJudge(e.target.value as Judge)}
              disabled={!canFire}
              className={cn(
                "w-full appearance-none bg-surface-2 border border-edge rounded px-3 py-2",
                "text-xs text-ink font-mono",
                "focus:outline-none focus:border-brand/50",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {JUDGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 w-3 h-3 text-brand/40" />
          </div>
        </div>

        {/* Multi-judge toggle */}
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-ink-muted/60 uppercase">
            Multi-judge
          </label>
          <button
            type="button"
            onClick={() => setMultiJudge((v) => !v)}
            disabled={!canFire}
            className={cn(
              "w-full h-[34px] rounded border text-xs font-mono transition-colors",
              multiJudge
                ? "border-brand/60 bg-brand/10 text-brand"
                : "border-edge bg-surface-2 text-ink-muted/60",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            {multiJudge ? "ativo" : "inativo"}
          </button>
        </div>
      </div>

      {/* Botão disparar */}
      <button
        type="button"
        onClick={handleFire}
        disabled={!canFire}
        className={cn(
          "w-full flex items-center justify-center gap-2",
          "rounded border border-brand/30 bg-brand/10",
          "px-4 py-2.5 text-xs font-semibold font-mono text-brand",
          "hover:bg-brand/20 hover:border-brand/60 transition-colors",
          "disabled:opacity-40 disabled:cursor-not-allowed"
        )}
      >
        {firing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Enfileirando…
          </>
        ) : (
          <>
            <Play className="w-3.5 h-3.5" />
            Disparar avaliação
          </>
        )}
      </button>

      {/* Erro */}
      {error && (
        <p className="text-xs font-mono text-danger border border-danger/20 rounded px-3 py-2 bg-danger/5">
          {error}
        </p>
      )}

      {/* Job ativo */}
      {activeJob && (
        <div className="border border-edge rounded px-3 py-2.5 bg-surface-2/60 space-y-1.5">
          <div className="flex items-center gap-2">
            {statusIcon(activeJob.status)}
            <span className="text-xs font-mono text-ink">
              {statusLabel(activeJob.status)}
            </span>
            <span className="ml-auto text-[10px] font-mono text-ink-muted/50">
              {formatRelative(activeJob.created_at)}
            </span>
          </div>
          <div className="text-[10px] font-mono text-ink-muted/50 space-x-2">
            <span>limit={activeJob.params.limit}</span>
            <span>judge={activeJob.params.judge}</span>
            {activeJob.params.multiJudge && <span>multi</span>}
            {activeJob.params.questionSet && activeJob.params.questionSet !== "all" && (
              <span>suite={activeJob.params.questionSet}</span>
            )}
          </div>
        </div>
      )}

      {/* Jobs recentes (exceto o ativo) */}
      {recentJobs.filter((j) => j.status === "done" || j.status === "failed").length > 0 && (
        <div className="space-y-1">
          <span className="font-mono text-[10px] tracking-widest text-ink-muted/40 uppercase">
            Recentes
          </span>
          <div className="space-y-1">
            {recentJobs
              .filter((j) => j.status === "done" || j.status === "failed")
              .slice(0, 5)
              .map((job) => (
                <div
                  key={job.id}
                  className="flex items-center gap-2 rounded px-2.5 py-1.5 bg-surface-2/30 border border-edge"
                >
                  {statusIcon(job.status)}
                  <span className="text-[10px] font-mono text-ink-muted/70 flex-1">
                    limit={job.params.limit} · {job.params.judge}
                    {job.params.questionSet && job.params.questionSet !== "all" && (
                      <> · suite={job.params.questionSet}</>
                    )}
                    {job.run_id && (
                      <> · <span className="text-brand/70">{job.run_id}</span></>
                    )}
                    {job.error && (
                      <> · <span className="text-danger/80">{job.error.slice(0, 60)}</span></>
                    )}
                  </span>
                  <span className="text-[10px] font-mono text-ink-muted/40 shrink-0">
                    {formatRelative(job.created_at)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}