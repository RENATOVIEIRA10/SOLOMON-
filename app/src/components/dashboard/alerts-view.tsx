"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ExternalLink, Bell } from "lucide-react";
import { useBrokerId } from "@/hooks/use-broker-id";
import { Card, CardContent } from "@/components/ui/card";

type Alert = {
  id: string;
  type: string;
  title: string;
  message: string;
  source_url: string | null;
  read: boolean;
  created_at: string;
};

const TYPE_META: Record<string, { label: string; color: string }> = {
  regulatory: {
    label: "Regulatório",
    color: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  },
  product_change: {
    label: "Mudança de produto",
    color: "bg-solomon-gold/20 text-solomon-gold border-solomon-gold/30",
  },
  new_product: {
    label: "Novo produto",
    color: "bg-green-500/20 text-green-300 border-green-500/30",
  },
  expiring_policy: {
    label: "Apólice expirando",
    color: "bg-red-500/20 text-red-300 border-red-500/30",
  },
};

export function AlertsView() {
  const brokerId = useBrokerId();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!brokerId) return;
    fetch("/api/alerts?limit=30")
      .then((r) => r.json())
      .then((d) => {
        setAlerts(d.alerts ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [brokerId]);

  return (
    <div className="flex-1 px-6 md:px-10 py-8 md:py-10 safe-top max-w-4xl mx-auto w-full">
      <header className="mb-8 md:mb-10">
        <div className="flex items-center gap-2 mb-2">
          <span className="mono-tag">Feed</span>
          <span className="gold-rule flex-1 max-w-[60px]" />
        </div>
        <h1 className="font-display text-4xl text-solomon-cream tracking-tight text-balance">
          Alertas
        </h1>
        <p className="mt-2 text-sm text-solomon-cream-muted max-w-2xl leading-relaxed text-pretty">
          Monitore mudanças em condições gerais, atualizações de novos produtos e comunicados regulatórios das seguradoras parceiras.
        </p>
      </header>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.p
            key="loading"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="text-sm text-solomon-cream-muted"
          >
            Carregando...
          </motion.p>
        ) : alerts.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <CardContent className="py-12 text-center">
                <Bell className="h-8 w-8 text-solomon-cream-muted/40 mx-auto mb-3" />
                <p className="text-solomon-cream-muted">Sem alertas no momento.</p>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((alert, i) => {
            const meta = TYPE_META[alert.type] ?? {
              label: alert.type,
              color: "bg-solomon-charcoal text-solomon-cream-muted border-solomon-gold/10",
            };
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
                <Card className="hover:border-solomon-gold/30 transition-colors">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <span
                        className={`shrink-0 font-mono text-[10px] px-2.5 py-1 rounded-md border uppercase tracking-wider ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-display text-lg text-solomon-cream">
                            {alert.title}
                          </h3>
                          <time className="shrink-0 font-mono text-[10px] text-solomon-cream-muted/60 uppercase tracking-widest mt-1">
                            {formatDate(alert.created_at)}
                          </time>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-solomon-cream-muted">
                          {alert.message}
                        </p>
                        {alert.source_url && (
                          <a
                            href={alert.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 text-xs text-solomon-gold hover:text-solomon-gold-light transition-colors"
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
