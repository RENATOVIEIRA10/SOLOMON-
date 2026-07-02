"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Printer,
  AlertTriangle,
  Scale,
} from "lucide-react";
import { useInsurers } from "@/hooks/use-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";

interface CompareResult {
  insurerNames: string[];
  productType: string;
  dimensions: Array<{
    dimension: string;
    rows: Array<{
      insurerName: string;
      value: string;
      advantage?: "win" | "lose" | "neutral";
    }>;
  }>;
  summary: string;
}

const PRODUCT_TYPES = [
  { value: "vida_individual", label: "Vida Individual" },
  { value: "vida_em_grupo", label: "Vida em Grupo" },
  { value: "vida_temporario", label: "Vida Temporário" },
  { value: "vida_vitalicio", label: "Vida Vitalício" },
];

export function ComparadorView() {
  const { insurers, error: insurersError, mutate: mutateInsurers } = useInsurers();
  const [selected, setSelected] = useState<string[]>([]);
  const [productType, setProductType] = useState("vida_individual");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleInsurer(name: string) {
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= 3) return prev;
      return [...prev, name];
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length < 2 || loading) return;
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const data = await apiFetch<CompareResult>("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insurerNames: selected, productType }),
      });
      setResult(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Erro inesperado.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-6xl mx-auto w-full">
      <header className="mb-8 md:mb-10">
        <div className="flex items-center gap-2 mb-2">
          <span className="mono-tag">Análise lado a lado</span>
          <span className="gold-rule flex-1 max-w-[60px]" />
        </div>
        <h1 className="font-display text-4xl text-ink tracking-tight text-balance">
          Comparador
        </h1>
        <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed text-pretty">
          Selecione de 2 a 3 seguradoras e analise coberturas, exclusões e carências em paralelo. Destaques visuais revelam vantagens e desvantagens de cada proposta.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Seleção</CardTitle>
          <CardDescription>
            Escolha o produto e 2-3 seguradoras para comparar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Tipo de produto</Label>
              <Select
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
              >
                {PRODUCT_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label className="mb-2 block">
                Seguradoras ({selected.length}/3)
              </Label>
              {insurersError && insurers.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Não foi possível carregar as seguradoras.{" "}
                  <button
                    type="button"
                    onClick={() => mutateInsurers()}
                    className="text-brand hover:text-brand-strong transition-premium cursor-pointer"
                  >
                    Tentar de novo
                  </button>
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {insurers.map((i) => {
                    const active = selected.includes(i.name);
                    const disabled = !active && selected.length >= 3;
                    return (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => toggleInsurer(i.name)}
                        disabled={disabled}
                        className={`px-3 py-2 rounded-md border text-xs text-left transition-colors ${
                          active
                            ? "border-brand bg-brand/10 text-brand"
                            : disabled
                            ? "border-edge bg-surface-2/30 text-ink-muted/40 cursor-not-allowed"
                            : "border-edge bg-surface-2/60 text-ink hover:border-brand/50"
                        }`}
                      >
                        {i.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={selected.length < 2 || loading}
            >
              {loading ? "Comparando..." : "Gerar comparativo"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card className="border-destructive/40 bg-destructive/5 mb-6">
              <CardContent className="py-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-ink">{error}</p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      )}

      {result && <CompareTable result={result} />}
    </div>
  );
}

function CompareTable({ result }: { result: CompareResult }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      id="compare-result"
    >
      <div className="flex items-center justify-between mb-4 print:hidden">
        <h2 className="font-display text-2xl text-ink flex items-center gap-2">
          <Scale className="h-6 w-6 text-brand" />
          Comparativo
        </h2>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Exportar PDF
        </Button>
      </div>

      {result.summary && (
        <Card className="mb-4 border-brand/30 bg-brand/5">
          <CardContent className="py-4">
            <p className="text-sm leading-relaxed text-ink">
              {result.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Mobile-friendly comparison cards */}
      <div className="block md:hidden space-y-4">
        {result.dimensions.map((dim, i) => (
          <Card key={i} className="border border-edge bg-surface/40">
            <CardHeader className="py-3 px-4 border-b border-edge bg-brand/2">
              <CardTitle className="text-sm font-display text-brand tracking-wide">
                {dim.dimension}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3.5">
              {result.insurerNames.map((name) => {
                const row = dim.rows.find((r) => r.insurerName === name);
                return (
                  <div key={name} className="flex flex-col gap-1.5 border-b border-edge pb-3 last:border-b-0 last:pb-0">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-ink-muted/70">
                      {name}
                    </span>
                    {row ? (
                      <div className="flex items-start gap-2">
                        <AdvantageBadge advantage={row.advantage} />
                        <p className="text-sm text-ink leading-relaxed">
                          {row.value}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-muted/70">
                        — Sem dados —
                      </span>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop side-by-side table */}
      <div className="hidden md:block">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge">
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-ink-muted font-medium w-1/4">
                    Dimensão
                  </th>
                  {result.insurerNames.map((name) => (
                    <th
                      key={name}
                      className="text-left px-5 py-3 text-xs uppercase tracking-widest text-brand font-medium font-display"
                    >
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.dimensions.map((dim, i) => (
                  <tr
                    key={i}
                    className="border-b border-edge hover:bg-surface-2/30"
                  >
                    <td className="align-top px-5 py-4 text-sm text-ink font-medium">
                      {dim.dimension}
                    </td>
                    {result.insurerNames.map((name) => {
                      const row = dim.rows.find((r) => r.insurerName === name);
                      return (
                        <td key={name} className="align-top px-5 py-4">
                          {row ? (
                            <div className="flex items-start gap-2">
                              <AdvantageBadge advantage={row.advantage} />
                              <p className="text-sm text-ink leading-relaxed">
                                {row.value}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-ink-muted/70">
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

function AdvantageBadge({
  advantage,
}: {
  advantage?: "win" | "lose" | "neutral";
}) {
  if (advantage === "win")
    return (
      <TrendingUp className="h-4 w-4 text-success shrink-0 mt-0.5" />
    );
  if (advantage === "lose")
    return <TrendingDown className="h-4 w-4 text-danger shrink-0 mt-0.5" />;
  if (advantage === "neutral")
    return <Minus className="h-4 w-4 text-ink-muted/60 shrink-0 mt-0.5" />;
  return null;
}
