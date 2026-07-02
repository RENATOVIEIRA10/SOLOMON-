"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import {
  MessageCircle,
  MessageSquare,
  ChevronDown,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { useBrokerId } from "@/hooks/use-broker-id";
import { useConversations } from "@/hooks/use-data";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

const ease = [0.22, 1, 0.36, 1] as const;

export function WhatsAppInbox() {
  const brokerId = useBrokerId();
  const { conversations: items, isLoading: loading, error, mutate } = useConversations("whatsapp", 50);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [onlyLowConfidence, setOnlyLowConfidence] = useState(false);
  void brokerId;

  const lowConfidenceCount = items.filter((c) => c.low_confidence).length;
  const visible = onlyLowConfidence
    ? items.filter((c) => c.low_confidence)
    : items;

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-5xl w-full mx-auto ambient-grid">
      <motion.header
        {...fadeUp}
        transition={{ duration: 0.55, ease }}
        className="mb-8 md:mb-10"
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="mono-tag">Canal · WhatsApp</span>
          <span className="gold-rule flex-1 max-w-[120px]" />
        </div>
        <h1 className="font-display text-3xl md:text-4xl text-ink tracking-tight leading-[1.05]">
          Conversas do{" "}
          <span className="italic text-brand-strong">
            WhatsApp
          </span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm md:text-base text-ink-muted leading-relaxed">
          Tudo que você perguntou ao SOLOMON pelo WhatsApp, organizado aqui —
          com fonte, confiança e continuidade no dashboard.
        </p>
      </motion.header>

      {/* Resumo + filtro de triagem */}
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.5, delay: 0.08, ease }}
        className="mb-6 flex flex-wrap items-center gap-3"
      >
        <span className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
          {/* placeholder não-quebrável: segura a altura da line-box durante o loading, evita CLS quando o texto real entra */}
          {loading ? <>&nbsp;</> : `${items.length} conversas recentes`}
        </span>
        {lowConfidenceCount > 0 && (
          <button
            type="button"
            onClick={() => setOnlyLowConfidence((v) => !v)}
            aria-pressed={onlyLowConfidence}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium tracking-wide border transition-colors",
              onlyLowConfidence
                ? "bg-warning/15 border-warning/40 text-warning"
                : "border-warning/20 text-warning/70 hover:border-warning/40 hover:text-warning"
            )}
          >
            <AlertTriangle className="size-3" />
            {lowConfidenceCount} com baixa confiança
          </button>
        )}
      </motion.div>

      {/* Lista */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.14, ease }}>
        {loading ? (
          <SkeletonList rows={5} />
        ) : error && items.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="Não foi possível carregar as conversas."
            description="Verifique sua conexão e tente novamente."
            action={{ label: "Tentar de novo", onClick: () => mutate() }}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={onlyLowConfidence ? "Nenhuma conversa com baixa confiança. Bom sinal." : "Nenhuma conversa pelo WhatsApp ainda."}
            description={onlyLowConfidence ? undefined : "Mande uma pergunta ao SOLOMON no WhatsApp e ela aparece aqui."}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {visible.map((c) => {
              const expanded = expandedId === c.id;
              const sourceCount = Array.isArray(c.sources)
                ? c.sources.length
                : 0;
              return (
                <li key={c.id}>
                  <Card
                    className={cn(
                      "p-0 overflow-hidden transition-premium",
                      expanded && "border-brand/30"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                      aria-expanded={expanded}
                      className="w-full text-left px-5 py-4 hover:bg-brand/4 transition-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-inset"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-success/10 text-success border border-success/20">
                          <MessageCircle className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink font-medium line-clamp-2">
                            {c.message}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <time className="font-mono text-[10px] uppercase tabular-nums text-ink-muted/70">
                              {formatDate(c.created_at)}
                            </time>
                            {c.low_confidence && (
                              <Badge variant="warning">Baixa confiança</Badge>
                            )}
                            {typeof c.confidence_score === "number" &&
                              !c.low_confidence && (
                                <span className="font-mono text-[9px] uppercase tracking-widest text-ink-muted/70">
                                  Confiança{" "}
                                  {Math.round(c.confidence_score * 100)}%
                                </span>
                              )}
                            {sourceCount > 0 && (
                              <span className="font-mono text-[9px] uppercase tracking-widest text-ink-muted/70">
                                {sourceCount}{" "}
                                {sourceCount === 1 ? "fonte" : "fontes"}
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronDown
                          className={cn(
                            "size-4 shrink-0 mt-1 text-ink-muted/40 transition-transform duration-200",
                            expanded && "rotate-180 text-brand"
                          )}
                        />
                      </div>
                    </button>
                    {expanded && (
                      <div className="px-5 pb-5 pt-1 border-t border-edge">
                        <p className="mt-3 text-sm text-ink-muted leading-relaxed whitespace-pre-wrap">
                          {c.response}
                        </p>
                        <Link
                          href="/chat"
                          className="mt-4 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-strong transition-premium"
                        >
                          Continuar no SOLOMON{" "}
                          <ArrowRight className="size-3" />
                        </Link>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </motion.div>
    </div>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
