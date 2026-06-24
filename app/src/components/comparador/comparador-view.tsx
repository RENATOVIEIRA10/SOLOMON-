"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Printer,
  AlertTriangle,
  Scale,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Insurer = { id: string; name: string };

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
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [productType, setProductType] = useState("vida_individual");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/insurers")
      .then((r) => r.json())
      .then((d) => setInsurers(d.insurers ?? []))
      .catch(() => {});
  }, []);

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
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insurerNames: selected, productType }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      else setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
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
        <h1 className="font-display text-4xl text-solomon-cream tracking-tight">
          Comparador
        </h1>
        <p className="mt-2 text-sm text-solomon-cream-muted max-w-2xl leading-relaxed">
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
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-widest text-solomon-cream-muted">
                Tipo de produto
              </span>
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="h-10 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 px-3 text-sm text-solomon-cream focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20"
              >
                {PRODUCT_TYPES.map((p) => (
                  <option key={p.value} value={p.value} className="bg-solomon-graphite">
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <p className="text-xs uppercase tracking-widest text-solomon-cream-muted mb-2">
                Seguradoras ({selected.length}/3)
              </p>
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
                          ? "border-solomon-gold bg-solomon-gold/10 text-solomon-gold"
                          : disabled
                          ? "border-solomon-gold/10 bg-solomon-charcoal/30 text-solomon-cream-muted/40 cursor-not-allowed"
                          : "border-solomon-gold/20 bg-solomon-charcoal/60 text-solomon-cream hover:border-solomon-gold/50"
                      }`}
                    >
                      {i.name}
                    </button>
                  );
                })}
              </div>
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
                <p className="text-sm text-solomon-cream">{error}</p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

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
        <h2 className="font-display text-2xl text-solomon-cream flex items-center gap-2">
          <Scale className="h-6 w-6 text-solomon-gold" />
          Comparativo
        </h2>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Exportar PDF
        </Button>
      </div>

      {result.summary && (
        <Card className="mb-4 border-solomon-gold/30 bg-solomon-gold/5">
          <CardContent className="py-4">
            <p className="text-sm leading-relaxed text-solomon-cream">
              {result.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Mobile-friendly comparison cards */}
      <div className="block md:hidden space-y-4">
        {result.dimensions.map((dim, i) => (
          <Card key={i} className="border border-solomon-gold/15 bg-solomon-graphite/40">
            <CardHeader className="py-3 px-4 border-b border-solomon-gold/10 bg-solomon-gold/[0.02]">
              <CardTitle className="text-sm font-display text-solomon-gold tracking-wide">
                {dim.dimension}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3.5">
              {result.insurerNames.map((name) => {
                const row = dim.rows.find((r) => r.insurerName === name);
                return (
                  <div key={name} className="flex flex-col gap-1.5 border-b border-solomon-gold/5 pb-3 last:border-b-0 last:pb-0">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-solomon-cream-muted/70">
                      {name}
                    </span>
                    {row ? (
                      <div className="flex items-start gap-2">
                        <AdvantageBadge advantage={row.advantage} />
                        <p className="text-sm text-solomon-cream leading-relaxed">
                          {row.value}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-solomon-cream-muted/40">
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
                <tr className="border-b border-solomon-gold/20">
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-solomon-cream-muted font-medium w-1/4">
                    Dimensão
                  </th>
                  {result.insurerNames.map((name) => (
                    <th
                      key={name}
                      className="text-left px-5 py-3 text-xs uppercase tracking-widest text-solomon-gold font-medium font-display"
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
                    className="border-b border-solomon-gold/10 hover:bg-solomon-charcoal/30"
                  >
                    <td className="align-top px-5 py-4 text-sm text-solomon-cream font-medium">
                      {dim.dimension}
                    </td>
                    {result.insurerNames.map((name) => {
                      const row = dim.rows.find((r) => r.insurerName === name);
                      return (
                        <td key={name} className="align-top px-5 py-4">
                          {row ? (
                            <div className="flex items-start gap-2">
                              <AdvantageBadge advantage={row.advantage} />
                              <p className="text-sm text-solomon-cream leading-relaxed">
                                {row.value}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-solomon-cream-muted/50">
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
      <TrendingUp className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
    );
  if (advantage === "lose")
    return <TrendingDown className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />;
  if (advantage === "neutral")
    return <Minus className="h-4 w-4 text-solomon-cream-muted/60 shrink-0 mt-0.5" />;
  return <X className="hidden" />;
}
