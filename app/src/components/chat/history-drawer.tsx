"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "motion/react";
import { History, X, MessageSquare, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SkeletonList } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useConversations } from "@/hooks/use-data";

type HistoryItem = {
  id: string;
  message: string;
  response: string;
  created_at: string;
  channel?: string | null;
  confidence_score?: number | null;
  low_confidence?: boolean | null;
};

type ChannelFilter = "all" | "whatsapp" | "dashboard";

const CHANNEL_FILTERS: { value: ChannelFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "dashboard", label: "Dashboard" },
];

export function HistoryDrawer({
  brokerId,
  onSelect,
}: {
  brokerId: string | null;
  onSelect: (item: HistoryItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<ChannelFilter>("all");

  const { conversations, isLoading, error, mutate } = useConversations(
    filter === "all" ? undefined : filter,
    30
  );
  const items = open && brokerId ? conversations : [];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Abrir historico de consultas"
          className="inline-flex items-center gap-2 h-9 rounded-md border border-edge bg-surface-2/60 px-3 text-xs text-ink hover:border-brand/50 hover:bg-surface-2 transition-colors"
        >
          <History className="size-3.5 text-brand" />
          <span className="hidden sm:inline">Histórico</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed z-50 inset-y-0 right-0 h-full w-full sm:w-96 bg-surface border-l border-edge shadow-2xl shadow-black/50",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right duration-200 ease-out"
          )}
        >
          <div className="flex items-center justify-between px-5 safe-top pb-4 border-b border-edge">
            <Dialog.Title className="font-display text-xl text-ink">
              Histórico
            </Dialog.Title>
            <Dialog.Close
              aria-label="Fechar historico"
              className="rounded-md p-1.5 text-ink-muted hover:text-brand hover:bg-surface-2 transition-colors"
            >
              <X className="size-4" />
              <span className="sr-only">Fechar</span>
            </Dialog.Close>
          </div>

          <div
            role="tablist"
            aria-label="Filtrar histórico por canal"
            className="flex items-center gap-1.5 px-5 py-3 border-b border-edge"
          >
            {CHANNEL_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => {
                  if (f.value !== filter) {
                    setFilter(f.value);
                  }
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium tracking-wide transition-colors border",
                  filter === f.value
                    ? "bg-brand/10 border-brand/40 text-brand"
                    : "border-edge text-ink-muted hover:text-brand hover:border-brand/30"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto h-[calc(100dvh-128px)] px-3 py-3">
            <AnimatePresence mode="wait">
              {isLoading && items.length === 0 && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <SkeletonList rows={4} />
                </motion.div>
              )}
              {!isLoading && error && items.length === 0 && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <EmptyState
                    icon={AlertTriangle}
                    title="Não foi possível carregar o histórico."
                    description="Verifique sua conexão e tente novamente."
                    action={{ label: "Tentar de novo", onClick: () => mutate() }}
                  />
                </motion.div>
              )}
              {!isLoading && !error && items.length === 0 && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex flex-col items-center gap-3 py-12 text-center text-ink-muted"
                >
                  <MessageSquare className="size-8 opacity-40" />
                  <p className="text-sm">Nenhuma consulta ainda.</p>
                  <p className="text-xs opacity-70">
                    Suas próximas perguntas aparecerão aqui.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
            <ul className="flex flex-col gap-1.5">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => {
                      onSelect(item);
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-md hover:bg-surface-2/70 transition-colors group"
                    type="button"
                  >
                    <p className="text-sm text-ink line-clamp-2 group-hover:text-brand-strong transition-colors">
                      {item.message}
                    </p>
                    <span className="mt-1 flex items-center gap-2">
                      <ChannelBadge channel={item.channel} />
                      {item.low_confidence && (
                        <Badge variant="warning">Baixa confiança</Badge>
                      )}
                      <time className="font-mono text-[10px] text-ink-muted/70 uppercase tabular-nums">
                        {formatDate(item.created_at)}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChannelBadge({ channel }: { channel?: string | null }) {
  if (channel === "whatsapp") return <Badge variant="success">WhatsApp</Badge>;
  if (channel === "dashboard") return <Badge variant="accent">Dashboard</Badge>;
  return null;
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
