"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { History, X, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type HistoryItem = {
  id: string;
  message: string;
  response: string;
  created_at: string;
};

export function HistoryDrawer({
  brokerId,
  onSelect,
}: {
  brokerId: string | null;
  onSelect: (item: HistoryItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !brokerId) return;
    setLoading(true);
    fetch(`/api/conversations?brokerId=${encodeURIComponent(brokerId)}&limit=30`)
      .then((r) => r.json())
      .then((data) => setItems(data.conversations ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, brokerId]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 h-9 rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 px-3 text-xs text-solomon-cream hover:border-solomon-gold/50 hover:bg-solomon-charcoal transition-colors"
        >
          <History className="h-3.5 w-3.5 text-solomon-gold" />
          <span className="hidden sm:inline">Histórico</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-solomon-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed z-50 inset-y-0 right-0 h-full w-full sm:w-96 bg-solomon-graphite border-l border-solomon-gold/20 shadow-2xl shadow-solomon-black/50",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right duration-300"
          )}
        >
          <div className="flex items-center justify-between px-5 safe-top pb-4 border-b border-solomon-gold/10">
            <Dialog.Title className="font-display text-xl text-solomon-cream">
              Histórico
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1.5 text-solomon-cream-muted hover:text-solomon-gold hover:bg-solomon-charcoal transition-colors">
              <X className="h-4 w-4" />
              <span className="sr-only">Fechar</span>
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto h-[calc(100dvh-80px)] px-3 py-3">
            {loading && (
              <p className="text-center text-xs text-solomon-cream-muted py-8">
                Carregando...
              </p>
            )}
            {!loading && items.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-12 text-center text-solomon-cream-muted">
                <MessageSquare className="h-8 w-8 opacity-40" />
                <p className="text-sm">Nenhuma consulta ainda.</p>
                <p className="text-xs opacity-70">
                  Suas próximas perguntas aparecerão aqui.
                </p>
              </div>
            )}
            <ul className="flex flex-col gap-1.5">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => {
                      onSelect(item);
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-md hover:bg-solomon-charcoal/70 transition-colors group"
                    type="button"
                  >
                    <p className="text-sm text-solomon-cream line-clamp-2 group-hover:text-solomon-gold-light transition-colors">
                      {item.message}
                    </p>
                    <time className="font-mono text-[10px] text-solomon-cream-muted/60 uppercase tracking-wider mt-1 block">
                      {formatDate(item.created_at)}
                    </time>
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
