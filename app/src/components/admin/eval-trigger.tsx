"use client";

/**
 * EvalTrigger — painel de disparo de eval Ragas pela web.
 *
 * Ações:
 *   1. POST /api/admin/evals/trigger com { limit, judge, multiJudge }
 *   2. Ao receber 201, inicia polling GET /api/admin/evals/jobs a cada 8s
 *   3. Exibe status do job ativo: requested → running → done/failed
 *   4. Para o polling quando status done/failed
 *
 * Estética SOLOMON: gold, mono-tag, sem azul, sem emoji estrutural.
 * Ícones via lucide-react.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Play, RefreshCw, CheckCircle2, XCircle, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Judge = "openai" | "gemini" | "anthropic";
type JobStatus = "requested" | "running" | "done" | "failed";

interface EvalJob {
  id: string;
  status: JobStatus;
  params: { limit: number; judge: Judge; multiJudge: boolean };
  requested_by: string;
  run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

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
      return <RefreshCw className="w-3.5 h-3.5 animate-spin text-solomon-gold/70" />;
    case "running":
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-solomon-gold" />;
    case "done":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case "failed":
      return <XCircle className="w-3.5 h-3.5 text-red-400" />;
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
  const [limit, setLimit] = useState<number>(3);
  const [judge, setJudge] = useState<Judge>("openai");
  const [multiJudge, setMultiJudge] = useState<boolean>(false);

  const [firing, setFiring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeJob, setActiveJob] = useState<EvalJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<EvalJob[]>([]);
  const [polling, setPolling] = useState(false);

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
      const res = await fetch("/api/admin/evals/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit, judge, multiJudge }),
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
    <div className="border border-solomon-gold/20 rounded-lg bg-solomon-charcoal/40 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="font-mono text-[10px] tracking-widest text-solomon-gold/50 uppercase">
            eval / disparo
          </span>
          <h2 className="text-sm font-semibold text-solomon-cream">
            Disparar avaliação Ragas
          </h2>
        </div>
        {polling && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-solomon-gold/60">
            <Loader2 className="w-3 h-3 animate-spin" />
            polling
          </span>
        )}
      </div>

      {/* Controles */}
      <div className="grid grid-cols-3 gap-3">
        {/* Limit */}
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-solomon-cream-muted/60 uppercase">
            Questões
          </label>
          <div className="relative">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={!canFire}
              className={cn(
                "w-full appearance-none bg-solomon-charcoal border border-solomon-gold/20 rounded px-3 py-2",
                "text-xs text-solomon-cream font-mono",
                "focus:outline-none focus:border-solomon-gold/50",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {LIMIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 w-3 h-3 text-solomon-gold/40" />
          </div>
        </div>

        {/* Judge */}
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-solomon-cream-muted/60 uppercase">
            Judge
          </label>
          <div className="relative">
            <select
              value={judge}
              onChange={(e) => setJudge(e.target.value as Judge)}
              disabled={!canFire}
              className={cn(
                "w-full appearance-none bg-solomon-charcoal border border-solomon-gold/20 rounded px-3 py-2",
                "text-xs text-solomon-cream font-mono",
                "focus:outline-none focus:border-solomon-gold/50",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {JUDGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 w-3 h-3 text-solomon-gold/40" />
          </div>
        </div>

        {/* Multi-judge toggle */}
        <div className="space-y-1">
          <label className="font-mono text-[10px] tracking-widest text-solomon-cream-muted/60 uppercase">
            Multi-judge
          </label>
          <button
            type="button"
            onClick={() => setMultiJudge((v) => !v)}
            disabled={!canFire}
            className={cn(
              "w-full h-[34px] rounded border text-xs font-mono transition-colors",
              multiJudge
                ? "border-solomon-gold/60 bg-solomon-gold/10 text-solomon-gold"
                : "border-solomon-gold/20 bg-solomon-charcoal text-solomon-cream-muted/60",
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
          "rounded border border-solomon-gold/30 bg-solomon-gold/10",
          "px-4 py-2.5 text-xs font-semibold font-mono text-solomon-gold",
          "hover:bg-solomon-gold/20 hover:border-solomon-gold/60 transition-colors",
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
        <p className="text-xs font-mono text-red-400 border border-red-400/20 rounded px-3 py-2 bg-red-400/5">
          {error}
        </p>
      )}

      {/* Job ativo */}
      {activeJob && (
        <div className="border border-solomon-gold/20 rounded px-3 py-2.5 bg-solomon-charcoal/60 space-y-1.5">
          <div className="flex items-center gap-2">
            {statusIcon(activeJob.status)}
            <span className="text-xs font-mono text-solomon-cream">
              {statusLabel(activeJob.status)}
            </span>
            <span className="ml-auto text-[10px] font-mono text-solomon-cream-muted/50">
              {formatRelative(activeJob.created_at)}
            </span>
          </div>
          <div className="text-[10px] font-mono text-solomon-cream-muted/50 space-x-2">
            <span>limit={activeJob.params.limit}</span>
            <span>judge={activeJob.params.judge}</span>
            {activeJob.params.multiJudge && <span>multi</span>}
          </div>
        </div>
      )}

      {/* Jobs recentes (exceto o ativo) */}
      {recentJobs.filter((j) => j.status === "done" || j.status === "failed").length > 0 && (
        <div className="space-y-1">
          <span className="font-mono text-[10px] tracking-widest text-solomon-cream-muted/40 uppercase">
            Recentes
          </span>
          <div className="space-y-1">
            {recentJobs
              .filter((j) => j.status === "done" || j.status === "failed")
              .slice(0, 5)
              .map((job) => (
                <div
                  key={job.id}
                  className="flex items-center gap-2 rounded px-2.5 py-1.5 bg-solomon-charcoal/30 border border-solomon-gold/10"
                >
                  {statusIcon(job.status)}
                  <span className="text-[10px] font-mono text-solomon-cream-muted/70 flex-1">
                    limit={job.params.limit} · {job.params.judge}
                    {job.run_id && (
                      <> · <span className="text-solomon-gold/70">{job.run_id}</span></>
                    )}
                    {job.error && (
                      <> · <span className="text-red-400/80">{job.error.slice(0, 60)}</span></>
                    )}
                  </span>
                  <span className="text-[10px] font-mono text-solomon-cream-muted/40 shrink-0">
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
