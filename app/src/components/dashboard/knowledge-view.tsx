"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, ExternalLink, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { InsurerFilter } from "@/components/chat/insurer-filter";

type KnowledgeResult = {
  id: string;
  content: string;
  similarity: number;
  source_url: string | null;
  insurer: string;
  product: string | null;
  susep_process: string | null;
};

export function KnowledgeView() {
  const [query, setQuery] = useState("");
  const [insurer, setInsurer] = useState<string | null>(null);
  const [results, setResults] = useState<KnowledgeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 3 || loading) return;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ q: query.trim(), limit: "15" });
    if (insurer) params.set("insurer", insurer);
    try {
      const r = await fetch(`/api/knowledge/search?${params.toString()}`);
      if (!r.ok) throw new Error("request failed");
      const d = await r.json();
      setResults(d.results ?? []);
    } catch {
      setError(true);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-4xl mx-auto w-full">
      <header className="mb-8 md:mb-10">
        <div className="flex items-center gap-2 mb-2">
          <span className="mono-tag">Busca direta</span>
          <span className="gold-rule flex-1 max-w-[60px]" />
        </div>
        <h1 className="font-display text-4xl text-ink tracking-tight text-balance">
          Base de Conhecimento
        </h1>
        <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed text-pretty">
          Busque cláusulas e termos literais nas condições gerais indexadas. Sem interpretação sintética da IA — o texto cru, exatamente como publicado nos regulamentos.
        </p>
      </header>

      <form onSubmit={search} className="mb-8 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <InsurerFilter value={insurer} onChange={setInsurer} />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted/60" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ex: carência para morte por doença, IPA majorada, contestabilidade..."
            className="h-12 pl-10 pr-28"
          />
          <Button
            type="submit"
            size="sm"
            disabled={query.trim().length < 3 || loading}
            className="absolute right-1.5 top-1/2 -translate-y-1/2"
          >
            {loading ? "Buscando..." : "Buscar"}
          </Button>
        </div>
      </form>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <SkeletonList rows={4} />
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <EmptyState
                icon={BookOpen}
                title="Não foi possível buscar na base de conhecimento."
                action={{ label: "Tentar de novo", onClick: () => search() }}
              />
            </Card>
          </motion.div>
        ) : results === null ? (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <EmptyState
                icon={BookOpen}
                title="Digite uma pergunta ou termo para buscar nas condições gerais."
              />
            </Card>
          </motion.div>
        ) : results.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <EmptyState
                icon={BookOpen}
                title="Nenhum trecho encontrado."
                description={`Tente outro termo${insurer ? ` ou remova o filtro ${insurer}` : ""}.`}
              />
            </Card>
          </motion.div>
        ) : (
        <ul className="flex flex-col gap-4">
          {results.map((r, i) => (
            <motion.li
              key={r.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
            >
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-sm text-ink font-semibold">
                        {r.insurer}
                      </span>
                      {r.product && (
                        <>
                          <span className="text-ink-muted/40">·</span>
                          <span className="text-xs text-ink-muted">
                            {r.product}
                          </span>
                        </>
                      )}
                      {r.susep_process && (
                        <span className="font-mono text-[10px] text-ink-muted/70 bg-surface-2 px-1.5 py-0.5 rounded">
                          SUSEP {r.susep_process}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-brand/70 bg-brand/10 px-2 py-0.5 rounded">
                      {Math.round(r.similarity * 100)}%
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-ink whitespace-pre-wrap">
                    {r.content}
                  </p>
                  {r.source_url && (
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-strong transition-colors"
                    >
                      Abrir documento fonte <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </CardContent>
              </Card>
            </motion.li>
          ))}
        </ul>
        )}
      </AnimatePresence>
    </div>
  );
}
