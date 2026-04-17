"use client";

import { useState } from "react";
import { Search, ExternalLink, BookOpen } from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 3 || loading) return;
    setLoading(true);
    const params = new URLSearchParams({ q: query.trim(), limit: "15" });
    if (insurer) params.set("insurer", insurer);
    const r = await fetch(`/api/knowledge/search?${params.toString()}`);
    const d = await r.json();
    setResults(d.results ?? []);
    setLoading(false);
  }

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-4xl mx-auto w-full">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-widest text-solomon-gold/80">
          Busca direta
        </p>
        <h1 className="mt-2 font-display text-4xl text-solomon-cream">
          Base de Conhecimento
        </h1>
        <p className="mt-2 text-sm text-solomon-cream-muted max-w-2xl">
          Busque trechos exatos das condições gerais indexadas. Sem
          interpretação da IA — o texto cru, como está no PDF.
        </p>
      </header>

      <form onSubmit={search} className="mb-8 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <InsurerFilter value={insurer} onChange={setInsurer} />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-solomon-cream-muted/60" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ex: carência para morte por doença, IPA majorada, contestabilidade..."
            className="w-full h-12 pl-10 pr-28 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20"
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

      {results === null ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-8 w-8 text-solomon-cream-muted/40 mx-auto mb-3" />
            <p className="text-solomon-cream-muted">
              Digite uma pergunta ou termo para buscar nas condições gerais.
            </p>
          </CardContent>
        </Card>
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-solomon-cream-muted">
              Nenhum trecho encontrado. Tente outro termo{insurer ? ` ou remova o filtro ${insurer}` : ""}.
            </p>
          </CardContent>
        </Card>
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
                      <span className="font-display text-sm text-solomon-cream font-semibold">
                        {r.insurer}
                      </span>
                      {r.product && (
                        <>
                          <span className="text-solomon-cream-muted/40">·</span>
                          <span className="text-xs text-solomon-cream-muted">
                            {r.product}
                          </span>
                        </>
                      )}
                      {r.susep_process && (
                        <span className="font-mono text-[10px] text-solomon-cream-muted/60 bg-solomon-charcoal px-1.5 py-0.5 rounded">
                          SUSEP {r.susep_process}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-solomon-gold/70 bg-solomon-gold/10 px-2 py-0.5 rounded">
                      {Math.round(r.similarity * 100)}%
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-solomon-cream whitespace-pre-wrap">
                    {r.content}
                  </p>
                  {r.source_url && (
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs text-solomon-gold hover:text-solomon-gold-light transition-colors"
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
    </div>
  );
}
