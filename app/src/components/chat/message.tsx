"use client";

import { useState, useEffect } from "react";
import { Copy, Check, ThumbsUp, ThumbsDown, ExternalLink, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type Citation = {
  index: number;
  insurerName: string;
  productName: string;
  susepProcess: string | null;
  sourceUrl: string | null;
  excerpt: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  conversationId?: string;
  confidenceScore?: number;
  lowConfidence?: boolean;
  answerWarnings?: string[];
  loading?: boolean;
  feedback?: "up" | "down" | null;
};

export function MessageBubble({
  message,
  onFeedback,
}: {
  message: ChatMessage;
  onFeedback?: (rating: "up" | "down") => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("clipboard unavailable", e);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[88%] md:max-w-[80%] flex flex-col gap-2",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
            isUser
              ? "bg-brand text-canvas rounded-br-sm"
              : "bg-surface/80 text-ink border border-edge rounded-bl-sm"
          )}
        >
          {message.loading ? (
            <TypingIndicator />
          ) : (
            renderMessageContent(message.content, message.citations)
          )}
        </div>

        {!isUser && !message.loading && message.lowConfidence && (
          <div className="flex w-full items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-ink-muted">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <div className="min-w-0">
              <Badge variant="warning">
                Confianca baixa {typeof message.confidenceScore === "number" ? `${Math.round(message.confidenceScore * 100)}%` : ""}
              </Badge>
              {message.answerWarnings && message.answerWarnings.length > 0 && (
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {message.answerWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {!isUser && !message.loading && message.citations && message.citations.length > 0 && (
            <motion.div
              key="citations"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full flex flex-col gap-2 mt-1"
            >
              {message.citations.map((c) => (
                <CitationCard key={c.index} citation={c} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {!isUser && !message.loading && (
            <motion.div
              key="feedback"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex items-center gap-1 text-ink-muted/60 pt-1"
            >
              <button
                onClick={handleCopy}
                aria-label="Copiar resposta"
                className="p-1.5 rounded-md hover:text-brand hover:bg-surface/60 transition-colors"
                title="Copiar resposta"
                type="button"
              >
                {copied ? (
                  <Check className="size-3.5 text-brand" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
              <button
                onClick={() => onFeedback?.("up")}
                aria-label="Marcar resposta como util"
                className={cn(
                  "p-1.5 rounded-md hover:bg-surface/60 transition-colors",
                  message.feedback === "up"
                    ? "text-brand"
                    : "hover:text-brand"
                )}
                title="Resposta útil"
                type="button"
              >
                <ThumbsUp className="size-3.5" />
              </button>
              <button
                onClick={() => onFeedback?.("down")}
                aria-label="Marcar resposta com problema"
                className={cn(
                  "p-1.5 rounded-md hover:bg-surface/60 transition-colors",
                  message.feedback === "down"
                    ? "text-destructive"
                    : "hover:text-destructive"
                )}
                title="Resposta com problema"
                type="button"
              >
                <ThumbsDown className="size-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function renderMessageContent(text: string, citations?: Citation[]) {
  if (!citations || citations.length === 0) return text;
  const parts: Array<React.ReactNode> = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++}>{text.substring(lastIndex, match.index)}</span>
      );
    }
    const n = parseInt(match[1], 10);
    const hasCitation = citations.some((c) => c.index === n);
    parts.push(
      <span
        key={key++}
        className={cn(
          "inline-block font-mono text-[10px] font-semibold px-1.5 py-0.5 mx-0.5 rounded-md align-baseline",
          hasCitation
            ? "bg-brand/20 text-brand border border-brand/30"
            : "bg-surface-2 text-ink-muted"
        )}
      >
        {n}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.substring(lastIndex)}</span>);
  }
  return parts;
}

function CitationCard({ citation }: { citation: Citation }) {
  return (
    <a
      href={citation.sourceUrl ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col gap-1.5 px-4 py-3 rounded-xl border border-edge bg-surface/30 hover:bg-surface/60 hover:border-brand/30 transition-premium text-xs"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] font-semibold text-brand bg-brand/10 px-1.5 py-0.5 rounded">
          {citation.index}
        </span>
        <span className="font-medium text-ink font-display text-sm tracking-wide">
          {citation.insurerName}
        </span>
        <span className="text-brand/40">·</span>
        <span className="text-ink-muted/80 flex-1 truncate font-mono text-[11px]">
          {citation.productName}
        </span>
        {citation.sourceUrl && (
          <ExternalLink className="size-3 text-ink-muted/50 group-hover:text-brand transition-colors shrink-0" />
        )}
      </div>
      {citation.excerpt && (
        <p className="text-[11px] text-ink-muted/65 leading-relaxed font-mono pl-3 border-l border-edge ml-2 italic group-hover:text-ink-muted/85 transition-colors">
          &quot;{citation.excerpt.trim()}&quot;
        </p>
      )}
      {citation.susepProcess && (
        <span className="font-mono text-[9px] text-ink-muted/40 pl-7 mt-0.5">
          SUSEP {citation.susepProcess}
        </span>
      )}
    </a>
  );
}

const WISDOM_QUOTES = [
  "A sabedoria é o alvo do prudente.",
  "Quem anda com os sábios será sábio.",
  "Como águas profundas é o conselho no coração.",
  "O homem prudente prevê o perigo e busca proteção.",
  "Os planos bem preparados levam ao sucesso.",
  "O coração inteligente busca o conhecimento.",
  "Adquira a sabedoria e o entendimento."
];

function TypingIndicator() {
  const [quoteIndex, setQuoteIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % WISDOM_QUOTES.length);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col gap-2 py-1 px-1 max-w-[260px] sm:max-w-xs md:max-w-md">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-brand animate-pulse [animation-delay:-0.3s]" />
        <span className="size-1.5 rounded-full bg-brand animate-pulse [animation-delay:-0.15s]" />
        <span className="size-1.5 rounded-full bg-brand animate-pulse" />
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={quoteIndex}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="text-[10px] font-mono tracking-wider text-brand/70 italic leading-snug"
        >
          {WISDOM_QUOTES[quoteIndex]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
