"use client";

import React, { useState, useMemo } from "react";
import {
  TrendingUp,
  Clock,
  HelpCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Search,
  CheckCircle2,
  Filter,
  Database,
  Layers,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EvalTrigger } from "@/components/admin/eval-trigger";
import { SkeletonList } from "@/components/ui/skeleton";

export interface EvalRunRow {
  id: string;
  project: string;
  run_id: string;
  question_id: string;
  category: string;
  question: string;
  ground_truth: string | null;
  answer: string | null;
  model: string | null;
  faithfulness: number | null;
  answer_correctness: number | null;
  context_precision: number | null;
  context_recall: number | null;
  noise_sensitivity: number | null;
  retrieved_chunk_count: number | null;
  retrieved_insurer_ids: string[] | null;
  retrieved_chunk_ids: string[] | null;
  latency_ms: number | null;
  judge_backend: string | null;
  judge_model: string | null;
  divergence_flag: boolean | null;
  divergence_metric: string | null;
  divergence_delta: number | null;
  divergence_judge_b: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface RunSummary {
  run_id: string;
  count: number;
  faithfulness: number;
  correctness: number;
  precision: number;
  recall: number;
  noise: number;
  latency: number;
  created_at: string;
}

interface EvalDashboardProps {
  summaries: RunSummary[];
  initialDetail: EvalRunRow[];
  allInsurers: Record<string, string>; // Maps ID -> Name
  isAdmin?: boolean;
}

const METRIC_CONFIGS = [
  {
    key: "faithfulness" as const,
    label: "Faithfulness",
    description: "Ausência de alucinações (grounded no contexto)",
    color: "var(--chart-1)",
    colorClass: "text-brand",
    stroke: "stroke-brand",
    bg: "bg-brand/10",
  },
  {
    key: "correctness" as const,
    label: "Correctness",
    description: "Fidelidade factual contra o gabarito",
    color: "var(--chart-2)",
    colorClass: "text-brand-strong",
    stroke: "stroke-brand-strong",
    bg: "bg-brand-strong/10",
  },
  {
    key: "precision" as const,
    label: "Context Precision",
    description: "Relevância das fontes recuperadas",
    color: "var(--chart-3)",
    colorClass: "text-success",
    stroke: "stroke-success",
    bg: "bg-success/10",
  },
  {
    key: "recall" as const,
    label: "Context Recall",
    description: "Taxa de fontes cruciais encontradas",
    color: "var(--chart-4)",
    colorClass: "text-info",
    stroke: "stroke-info",
    bg: "bg-info/10",
  },
  {
    key: "noise" as const,
    label: "Noise Sensitivity",
    description: "Resistência a chunks irrelevantes",
    color: "var(--chart-5)",
    colorClass: "text-[var(--chart-5)]",
    stroke: "stroke-[var(--chart-5)]",
    bg: "bg-[var(--chart-5)]/10",
  },
];

const CHART_WIDTH = 720;
const CHART_HEIGHT = 240;
const CHART_PADDING = { top: 15, right: 25, bottom: 35, left: 35 } as const;

export function EvalDashboard({ summaries, initialDetail, allInsurers, isAdmin = false }: EvalDashboardProps) {
  const [selectedRunId, setSelectedRunId] = useState<string>(
    summaries[0]?.run_id || ""
  );
  const [activeMetricHover, setActiveMetricHover] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [onlyDivergent, setOnlyDivergent] = useState<boolean>(false);
  const [expandedQs, setExpandedQs] = useState<Record<string, boolean>>({});

  // Since we fetch the detail for initial run, we either use initialDetail or query client side (simulated with standard state or props)
  // To keep it 100% server-compatible and responsive, we filter the raw detail rows passed in or simulated.
  // In our case, the parent component fetches detail for the `selectedRunId` via search query params or prop updates.
  // For the best UX, since Next.js route transitions can take a few ms, we can display the initialDetail when it matches selectedRunId,
  // or fetch dynamically via api. Here we can build an interactive UI.
  // To avoid reloading the entire page, we fetch the selected run details from a Client side fetch if it changes, or we can use server action.
  // Let's implement client-side cache & fetch for details of other runs!
  const [runDetailsCache, setRunDetailsCache] = useState<Record<string, EvalRunRow[]>>({
    [summaries[0]?.run_id]: initialDetail,
  });
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  const currentDetails = useMemo(() => {
    return runDetailsCache[selectedRunId] || [];
  }, [runDetailsCache, selectedRunId]);

  const handleRunChange = async (runId: string) => {
    setSelectedRunId(runId);
    if (runDetailsCache[runId]) return;

    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/evals?runId=${runId}`);
      if (res.ok) {
        const data = await res.json();
        setRunDetailsCache((prev) => ({ ...prev, [runId]: data }));
      }
    } catch (err) {
      console.error("Failed to fetch run details:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const selectedRunSummary = useMemo(() => {
    return summaries.find((s) => s.run_id === selectedRunId);
  }, [summaries, selectedRunId]);

  // Extract distinct categories in this run for filter dropdown
  const categories = useMemo(() => {
    const set = new Set<string>();
    currentDetails.forEach((d) => {
      if (d.category) set.add(d.category);
    });
    return Array.from(set);
  }, [currentDetails]);

  // Filtered rows
  const filteredDetails = useMemo(() => {
    return currentDetails.filter((d) => {
      if (categoryFilter !== "all" && d.category !== categoryFilter) return false;
      if (onlyDivergent && !d.divergence_flag) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const questionMatch = d.question?.toLowerCase().includes(q);
        const answerMatch = d.answer?.toLowerCase().includes(q);
        const groundTruthMatch = d.ground_truth?.toLowerCase().includes(q);
        if (!questionMatch && !answerMatch && !groundTruthMatch) return false;
      }
      return true;
    });
  }, [currentDetails, categoryFilter, onlyDivergent, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedQs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Helper to format dates from run_id (e.g. 20260604_172258 -> 04/06/2026 17:22)
  const formatRunId = (runId: string) => {
    if (!runId || runId.length < 15) return runId;
    const y = runId.substring(0, 4);
    const m = runId.substring(4, 6);
    const d = runId.substring(6, 8);
    const hr = runId.substring(9, 11);
    const min = runId.substring(11, 13);
    return `${d}/${m}/${y} ${hr}:${min}`;
  };

  // Score styling helpers
  const getMetricGrade = (key: string, val: number | null) => {
    if (val === null) return { text: "N/A", color: "text-ink-muted", bg: "bg-surface-2", border: "border-edge" };
    
    // Faithfulness & Correctness
    if (key === "faithfulness" || key === "correctness") {
      if (val >= 0.85) return { text: "Excelente", color: "text-success", bg: "bg-success/10", border: "border-success/20" };
      if (val >= 0.70) return { text: "Razoável", color: "text-warning", bg: "bg-warning/10", border: "border-warning/20" };
      return { text: "Crítico", color: "text-danger", bg: "bg-danger/10", border: "border-danger/20" };
    }

    // Context Precision & Recall
    if (val >= 0.80) return { text: "Excelente", color: "text-success", bg: "bg-success/10", border: "border-success/20" };
    if (val >= 0.65) return { text: "Razoável", color: "text-warning", bg: "bg-warning/10", border: "border-warning/20" };
    return { text: "Crítico", color: "text-danger", bg: "bg-danger/10", border: "border-danger/20" };
  };

  // Generate SVG Line Chart Data
  const chartWidth = CHART_WIDTH;
  const chartHeight = CHART_HEIGHT;
  const padding = CHART_PADDING;

  // Chronological order for chart (oldest to newest)
  const chronoSummaries = useMemo(() => {
    return [...summaries].reverse();
  }, [summaries]);

  const chartPoints = useMemo(() => {
    if (chronoSummaries.length === 0) return [];
    
    const count = chronoSummaries.length;
    const xStep = count > 1 ? (chartWidth - padding.left - padding.right) / (count - 1) : 0;
    
    return chronoSummaries.map((summary, idx) => {
      const x = padding.left + idx * xStep;
      
      const metricsY = {
        faithfulness: padding.top + (1 - summary.faithfulness) * (chartHeight - padding.top - padding.bottom),
        correctness: padding.top + (1 - summary.correctness) * (chartHeight - padding.top - padding.bottom),
        precision: padding.top + (1 - summary.precision) * (chartHeight - padding.top - padding.bottom),
        recall: padding.top + (1 - summary.recall) * (chartHeight - padding.top - padding.bottom),
        noise: padding.top + (1 - summary.noise) * (chartHeight - padding.top - padding.bottom),
      };

      return {
        run_id: summary.run_id,
        x,
        y: metricsY,
        summary,
      };
    });
  }, [
    chronoSummaries,
    chartHeight,
    chartWidth,
    padding.bottom,
    padding.left,
    padding.right,
    padding.top,
  ]);

  const drawPath = (metricKey: "faithfulness" | "correctness" | "precision" | "recall" | "noise") => {
    if (chartPoints.length === 0) return "";
    return chartPoints
      .map((p, idx) => {
        const cmd = idx === 0 ? "M" : "L";
        return `${cmd} ${p.x.toFixed(1)} ${p.y[metricKey].toFixed(1)}`;
      })
      .join(" ");
  };

  return (
    <div className="w-full flex flex-col gap-6 p-4 md:p-8 max-w-7xl mx-auto">
      {/* Painel de disparo — visível apenas para admin */}
      {isAdmin && <EvalTrigger />}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-edge pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="mono-tag">Qualidade Ragas</span>
            <span className="gold-rule flex-1 max-w-[60px]" />
          </div>
          <h1 className="font-display text-4xl text-ink tracking-tight text-balance">
            Evolução Ragas
          </h1>
          <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed text-pretty">
            Métricas de assertividade avaliadas automaticamente para monitorar a precisão e confiabilidade das respostas do SOLOMON.
          </p>
        </div>
        
        {/* Run Selector */}
        <div className="flex items-center gap-2 bg-surface-2/40 border border-edge rounded-lg p-1.5 px-3 backdrop-blur-sm">
          <Database className="h-4 w-4 text-brand" />
          <span className="text-xs text-ink-muted/80 font-semibold font-mono uppercase tracking-wider">Run Selecionada:</span>
          <select
            value={selectedRunId}
            onChange={(e) => handleRunChange(e.target.value)}
            className="bg-transparent text-sm text-brand-strong font-mono font-semibold focus:outline-none cursor-pointer pl-1"
          >
            {summaries.map((s) => (
              <option key={s.run_id} value={s.run_id} className="bg-canvas text-ink">
                {s.run_id} ({formatRunId(s.run_id).split(" ")[0]})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Metric Evolution Graph & Overview Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Evolution Chart */}
        <div className="lg:col-span-2 card-gold-gradient rounded-xl border border-edge p-5 bg-surface/20 backdrop-blur-sm flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-md font-semibold tracking-wide flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-brand" />
              Evolução Histórica das Runs
            </h2>
            <span className="text-[10px] text-ink-muted/70 font-mono tracking-widest uppercase">
              {chronoSummaries.length} checkpoints
            </span>
          </div>

          {/* SVG Graph */}
          <div className="w-full overflow-x-auto select-none pt-2">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full min-w-[640px] h-60"
            >
              <defs>
                {METRIC_CONFIGS.map((cfg) => (
                  <linearGradient key={cfg.key} id={`grad-${cfg.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={cfg.color} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={cfg.color} stopOpacity="0.0" />
                  </linearGradient>
                ))}
              </defs>

              {/* Grid Lines */}
              {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((val) => {
                const y = padding.top + (1 - val) * (chartHeight - padding.top - padding.bottom);
                return (
                  <g key={val} className="opacity-15">
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={chartWidth - padding.right}
                      y2={y}
                      stroke="var(--chart-grid)"
                      strokeWidth="0.7"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={padding.left - 8}
                      y={y + 3}
                      fill="var(--chart-label)"
                      fontSize="9"
                      fontFamily="monospace"
                      textAnchor="end"
                    >
                      {val.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {/* X Axis Labels */}
              {chartPoints.map((p, idx) => {
                // Show label on first, last, and intermediate points if there are many
                const showLabel =
                  idx === 0 ||
                  idx === chartPoints.length - 1 ||
                  (chartPoints.length > 5 && idx === Math.floor(chartPoints.length / 2));
                
                return (
                  <g key={p.run_id}>
                    {showLabel && (
                      <text
                        x={p.x}
                        y={chartHeight - 12}
                        fill="var(--chart-label)"
                        fontSize="9"
                        fontFamily="monospace"
                        textAnchor="middle"
                        className="opacity-40"
                      >
                        {p.run_id.split("_")[0].substring(4)}
                      </text>
                    )}
                    <line
                      x1={p.x}
                      y1={padding.top}
                      x2={p.x}
                      y2={chartHeight - padding.bottom}
                      stroke="var(--chart-grid)"
                      strokeWidth="0.5"
                      className="opacity-5"
                    />
                  </g>
                );
              })}

              {/* Lines & Shading */}
              {METRIC_CONFIGS.map((cfg) => {
                const isHovered = activeMetricHover === cfg.key;
                const isAnyHovered = activeMetricHover !== null;
                const opacity = isAnyHovered ? (isHovered ? 1 : 0.15) : 0.8;
                const strokeWidth = isHovered ? 3.5 : 2;

                const pathD = drawPath(cfg.key);
                if (!pathD) return null;

                return (
                  <g key={cfg.key} style={{ transition: "opacity 0.2s" }} className="hover:opacity-100">
                    {/* Shadow/Glowing Path for Active */}
                    {isHovered && (
                      <path
                        d={pathD}
                        fill="none"
                        stroke={cfg.color}
                        strokeWidth="8"
                        opacity="0.1"
                      />
                    )}
                    {/* Main Line */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke={cfg.color}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={opacity}
                    />

                    {/* Data Points */}
                    {chartPoints.map((p) => {
                      const val = p.summary[cfg.key];
                      const y = p.y[cfg.key];
                      return (
                        <circle
                          key={p.run_id}
                          cx={p.x}
                          cy={y}
                          r={isHovered ? 4.5 : 2.5}
                          fill="var(--ui-bg)"
                          stroke={cfg.color}
                          strokeWidth={isHovered ? 2 : 1.5}
                          opacity={opacity}
                          className="cursor-pointer"
                        >
                          <title>
                            {cfg.label} ({p.run_id}): {val.toFixed(3)}
                          </title>
                        </circle>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Legend and Interactive Controls */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 border-t border-edge pt-4">
            {METRIC_CONFIGS.map((cfg) => {
              const active = activeMetricHover === cfg.key;
              const val = selectedRunSummary ? selectedRunSummary[cfg.key] : 0;
              return (
                <div
                  key={cfg.key}
                  onMouseEnter={() => setActiveMetricHover(cfg.key)}
                  onMouseLeave={() => setActiveMetricHover(null)}
                  className={cn(
                    "flex flex-col p-2 rounded-lg border transition-all cursor-pointer",
                    active
                      ? "border-brand bg-brand/5"
                      : "border-transparent bg-surface-2/20 hover:border-brand/30"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: cfg.color }}
                    />
                    <span className="text-[10px] font-semibold text-ink-muted tracking-wide truncate">
                      {cfg.label}
                    </span>
                  </div>
                  <span className={cn("text-lg font-mono font-bold mt-1", cfg.colorClass)}>
                    {val ? val.toFixed(3) : "0.000"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Run Overview Card */}
        <div className="card-gold-gradient rounded-xl border border-edge p-5 bg-surface/20 backdrop-blur-sm flex flex-col justify-between">
          <div className="flex flex-col gap-4">
            <div>
              <span className="text-[10px] text-brand font-mono tracking-widest uppercase font-bold">Resumo da Run</span>
              <h2 className="text-xl font-display font-semibold text-ink mt-0.5 font-serif">
                {selectedRunId}
              </h2>
              <p className="text-xs text-ink-muted/70 mt-1 font-mono">
                Criada em: {formatRunId(selectedRunId)}
              </p>
            </div>

            <div className="divider-gold opacity-10 my-1" />

            {/* Aggregated Stats List */}
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-ink-muted/70 flex items-center gap-1.5">
                  <HelpCircle className="h-3.5 w-3.5 text-brand" />
                  Perguntas Avaliadas
                </span>
                <span className="font-mono font-bold text-ink text-sm">
                  {selectedRunSummary?.count || 0}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-ink-muted/70 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-brand" />
                  Latência Média
                </span>
                <span className="font-mono font-bold text-ink text-sm">
                  {selectedRunSummary ? (selectedRunSummary.latency / 1000).toFixed(2) : "0.00"}s
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-ink-muted/70 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-brand" />
                  Judge Backend
                </span>
                <span className="font-mono font-semibold text-brand-strong text-[11px] uppercase tracking-wide">
                  {currentDetails[0]?.judge_backend || "Gemini"}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-ink-muted/70 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-brand" />
                  Judge Model
                </span>
                <span className="font-mono text-[11px] text-ink-muted/90 truncate max-w-[150px]" title={currentDetails[0]?.judge_model || ""}>
                  {currentDetails[0]?.judge_model || "gemini-2.5-flash"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2.5">
            {/* Quick Status Message */}
            <div className="bg-surface-2/30 border border-edge rounded-lg p-3 text-xs flex flex-col gap-1.5">
              <span className="font-semibold text-brand-strong flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-brand" />
                Divergências de Judge
              </span>
              <p className="text-[11px] text-ink-muted/70 leading-relaxed">
                {currentDetails.filter((d) => d.divergence_flag).length} perguntas possuem divergência &gt;0.2 entre judges concorrentes.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Results / Filters */}
      <div className="card-gold-gradient rounded-xl border border-edge p-5 bg-surface/20 backdrop-blur-sm flex flex-col gap-5">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <h2 className="text-lg font-semibold tracking-wide flex items-center gap-2">
            <Filter className="h-4 w-4 text-brand" />
            Resultados Detalhados das Questões
          </h2>

          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative flex-1 sm:flex-initial min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar por pergunta/resposta..."
                className="w-full bg-canvas/60 border border-edge rounded-md py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:border-brand text-ink"
              />
            </div>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-canvas border border-edge text-xs text-ink rounded-md p-1.5 focus:outline-none cursor-pointer"
            >
              <option value="all">Todas Categorias</option>
              {categories.map((c) => (
                <option key={c} value={c} className="capitalize">
                  {c.replace("_", " ")}
                </option>
              ))}
            </select>

            {/* Divergent Flag Filter */}
            <label className="flex items-center gap-2 bg-canvas border border-edge rounded-md p-1.5 text-xs text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={onlyDivergent}
                onChange={(e) => setOnlyDivergent(e.target.checked)}
                className="accent-brand cursor-pointer"
              />
              <span>Apenas Divergentes</span>
            </label>
          </div>
        </div>

        {/* Detailed List */}
        {loadingDetail ? (
          <SkeletonList rows={4} />
        ) : filteredDetails.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-edge rounded-lg">
            <HelpCircle className="h-8 w-8 mx-auto text-brand/40" />
            <p className="text-sm text-ink-muted/80 mt-3 font-semibold">Nenhuma pergunta encontrada</p>
            <p className="text-xs text-ink-muted/70 mt-1">Ajuste os filtros ou verifique a busca.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredDetails.map((row) => {
              const expanded = expandedQs[row.id];
              return (
                <div
                  key={row.id}
                  className={cn(
                    "border rounded-lg bg-canvas/35 transition-all overflow-hidden",
                    row.divergence_flag ? "border-danger/25" : "border-edge hover:border-brand/25"
                  )}
                >
                  {/* Row Header Bar */}
                  <div
                    onClick={() => toggleExpand(row.id)}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 gap-3 cursor-pointer select-none"
                  >
                    <div className="flex-1 flex flex-col gap-1 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono tracking-widest font-bold uppercase bg-brand/15 text-brand py-0.5 px-1.5 rounded-sm">
                          {row.category}
                        </span>
                        {row.divergence_flag && (
                          <span className="text-[9px] font-mono tracking-widest font-bold uppercase bg-danger/15 text-danger py-0.5 px-1.5 rounded-sm flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" /> Divergência
                          </span>
                        )}
                        <span className="text-[10px] text-ink-muted/70 font-mono">
                          ID: {row.question_id}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-ink mt-1 leading-snug">
                        {row.question}
                      </p>
                    </div>

                    {/* Metric Badges */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Metric scores in columns */}
                      <div className="flex items-center gap-1.5">
                        {/* Faithfulness */}
                        {row.faithfulness !== null && (
                          <div className="flex flex-col items-center p-1 px-2 rounded bg-surface-2/50 border border-edge">
                            <span className="text-[8px] uppercase tracking-wider text-ink-muted/70 font-mono">F</span>
                            <span className={cn("text-xs font-mono font-semibold", getMetricGrade("faithfulness", row.faithfulness).color)}>
                              {row.faithfulness.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {/* Correctness */}
                        {row.answer_correctness !== null && (
                          <div className="flex flex-col items-center p-1 px-2 rounded bg-surface-2/50 border border-edge">
                            <span className="text-[8px] uppercase tracking-wider text-ink-muted/70 font-mono">AC</span>
                            <span className={cn("text-xs font-mono font-semibold", getMetricGrade("correctness", row.answer_correctness).color)}>
                              {row.answer_correctness.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {/* Context Recall */}
                        {row.context_recall !== null && (
                          <div className="flex flex-col items-center p-1 px-2 rounded bg-surface-2/50 border border-edge">
                            <span className="text-[8px] uppercase tracking-wider text-ink-muted/70 font-mono">CR</span>
                            <span className={cn("text-xs font-mono font-semibold", getMetricGrade("recall", row.context_recall).color)}>
                              {row.context_recall.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {/* Context Precision */}
                        {row.context_precision !== null && (
                          <div className="flex flex-col items-center p-1 px-2 rounded bg-surface-2/50 border border-edge">
                            <span className="text-[8px] uppercase tracking-wider text-ink-muted/70 font-mono">CP</span>
                            <span className={cn("text-xs font-mono font-semibold", getMetricGrade("precision", row.context_precision).color)}>
                              {row.context_precision.toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="ml-2 pl-2 border-l border-edge text-ink-muted/40 hover:text-brand transition-colors">
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {expanded && (
                    <div className="border-t border-edge bg-surface-2/15 p-4 md:p-6 flex flex-col gap-4 text-xs">
                      {/* Subtitle info */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-canvas/45 border border-edge rounded p-3">
                          <span className="text-[9px] uppercase tracking-widest text-brand font-mono block mb-1">RAG Model Utilizado</span>
                          <span className="font-mono text-ink text-xs">{row.model || "Desconhecido"}</span>
                        </div>
                        <div className="bg-canvas/45 border border-edge rounded p-3">
                          <span className="text-[9px] uppercase tracking-widest text-brand font-mono block mb-1">Latência do RAG</span>
                          <span className="font-mono text-ink text-xs">{row.latency_ms ? `${(row.latency_ms / 1000).toFixed(2)}s` : "N/A"}</span>
                        </div>
                        <div className="bg-canvas/45 border border-edge rounded p-3 col-span-1">
                          <span className="text-[9px] uppercase tracking-widest text-brand font-mono block mb-1">Seguradoras Consultadas</span>
                          <span className="font-sans text-ink text-xs truncate block" title={(row.retrieved_insurer_ids || []).map(id => allInsurers[id] || id).join(', ')}>
                            {row.retrieved_insurer_ids && row.retrieved_insurer_ids.length > 0
                              ? row.retrieved_insurer_ids.map((id) => allInsurers[id] || id).join(", ")
                              : "Nenhuma"}
                          </span>
                        </div>
                      </div>

                      {/* Side by side Q&A */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                        {/* Ground Truth */}
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] text-success font-semibold uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Gabarito (Ground Truth)
                          </span>
                          <div className="bg-canvas/30 border border-success/10 rounded-lg p-3 text-ink-muted min-h-[120px] font-sans leading-relaxed whitespace-pre-wrap">
                            {row.ground_truth || "Sem gabarito registrado para esta pergunta."}
                          </div>
                        </div>

                        {/* Generated Answer */}
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] text-brand font-semibold uppercase tracking-wider flex items-center gap-1">
                            <Sparkles className="h-3.5 w-3.5" /> Resposta da IA
                          </span>
                          <div className="bg-canvas/30 border border-edge rounded-lg p-3 text-ink min-h-[120px] font-sans leading-relaxed whitespace-pre-wrap">
                            {row.answer || "Sem resposta registrada."}
                          </div>
                        </div>
                      </div>

                      {/* Judge Divergences information */}
                      {row.divergence_flag && (
                        <div className="bg-danger/10 border border-danger/20 rounded-lg p-4 mt-2 text-xs flex flex-col gap-1">
                          <span className="font-semibold text-danger flex items-center gap-1.5">
                            <AlertTriangle className="h-4 w-4" /> Divergência Detectada entre Judges
                          </span>
                          <p className="text-ink-muted/80 leading-relaxed mt-1">
                            A métrica <strong className="text-danger uppercase font-mono">{row.divergence_metric}</strong> divergiu em{" "}
                            <strong className="text-danger font-mono">{row.divergence_delta ? row.divergence_delta.toFixed(3) : "0"}</strong>{" "}
                            entre o judge primário (Gemini) e o secundário (<span className="capitalize">{row.divergence_judge_b}</span>).
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
