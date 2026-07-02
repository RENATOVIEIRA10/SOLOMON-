"use client";

import { motion, AnimatePresence } from "motion/react";
import { ExternalLink, Bell } from "lucide-react";
import { useAlerts } from "@/hooks/use-data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

const TYPE_META: Record<string, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  regulatory: { label: "Regulatório", variant: "info" },
  product_change: { label: "Mudança de produto", variant: "accent" },
  new_product: { label: "Novo produto", variant: "success" },
  expiring_policy: { label: "Apólice expirando", variant: "danger" },
};

export function AlertsView() {
  const { alerts, isLoading, error, mutate } = useAlerts(30);

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-4xl mx-auto w-full">
      <header className="mb-8 md:mb-10">
        <div className="flex items-center gap-2 mb-2">
          <span className="mono-tag">Feed</span>
          <span className="gold-rule flex-1 max-w-[60px]" />
        </div>
        <h1 className="font-display text-4xl text-ink tracking-tight text-balance">
          Alertas
        </h1>
        <p className="mt-2 text-sm text-ink-muted max-w-2xl leading-relaxed text-pretty">
          Monitore mudanças em condições gerais, atualizações de novos produtos e comunicados regulatórios das seguradoras parceiras.
        </p>
      </header>

      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <SkeletonList rows={4} />
          </motion.div>
        ) : error && alerts.length === 0 ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <EmptyState
                icon={Bell}
                title="Não foi possível carregar os alertas."
                action={{ label: "Tentar de novo", onClick: () => mutate() }}
              />
            </Card>
          </motion.div>
        ) : alerts.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <EmptyState icon={Bell} title="Sem alertas no momento." />
            </Card>
          </motion.div>
        ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((alert, i) => {
            const meta = TYPE_META[alert.type] ?? { label: alert.type, variant: "neutral" as const };
            return (
              <motion.li
                key={alert.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.25,
                  delay: i * 0.04,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <Card className="hover:border-brand/30 transition-colors">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <Badge variant={meta.variant} className="shrink-0 text-[10px] px-2.5 py-1">
                        {meta.label}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-display text-lg text-ink">
                            {alert.title}
                          </h3>
                          <time className="shrink-0 font-mono text-[10px] text-ink-muted/60 uppercase tracking-widest mt-1">
                            {formatDate(alert.created_at)}
                          </time>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                          {alert.message}
                        </p>
                        {alert.source_url && (
                          <a
                            href={alert.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-strong transition-colors"
                          >
                            Abrir fonte <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.li>
            );
          })}
        </ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}
