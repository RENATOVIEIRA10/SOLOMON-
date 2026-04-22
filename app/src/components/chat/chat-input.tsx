"use client";

import { useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { InsurerFilter } from "./insurer-filter";

export function ChatInput({
  value,
  onChange,
  onSubmit,
  loading,
  insurer,
  onInsurerChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  insurer: string | null;
  onInsurerChange: (v: string | null) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    (ta as HTMLElement).style.height = "auto";
    (ta as HTMLElement).style.height = Math.min(ta.scrollHeight, 180) + "px";
  }, [value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !loading) onSubmit();
    }
  }

  const canSend = value.trim().length >= 3 && !loading;

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <InsurerFilter value={insurer} onChange={onInsurerChange} />
      </div>
      <div className="relative flex items-end gap-2 rounded-xl border border-solomon-gold/20 bg-solomon-graphite/80 p-2 focus-within:border-solomon-gold/60 focus-within:ring-2 focus-within:ring-solomon-gold/20 transition-colors">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte sobre condições gerais, coberturas, carências, exclusões..."
          rows={1}
          className="border-0 bg-transparent focus:ring-0 focus:border-0 min-h-[40px] max-h-[180px] py-2 px-2 text-sm"
          disabled={loading}
        />
        <Button
          type="button"
          size="icon"
          onClick={onSubmit}
          disabled={!canSend}
          className="shrink-0 h-10 w-10"
          aria-label="Enviar pergunta"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
      <p className="text-[10px] text-solomon-cream-muted/50 px-1">
        Enter para enviar · Shift+Enter para quebrar linha
      </p>
    </div>
  );
}
