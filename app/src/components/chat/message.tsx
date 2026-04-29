"use client";

import { useState } from "react";
import { Copy, Check, ThumbsUp, ThumbsDown, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

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
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
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
              ? "bg-solomon-gold text-solomon-black rounded-br-sm"
              : "bg-solomon-graphite/80 text-solomon-cream border border-solomon-gold/10 rounded-bl-sm"
          )}
        >
          {message.loading ? (
            <TypingIndicator />
          ) : (
            renderMessageContent(message.content, message.citations)
          )}
        </div>

        <AnimatePresence mode="wait">
          {!isUser && !message.loading && message.citations && message.citations.length > 0 && (
            <motion.div
              key="citations"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
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
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-1 text-solomon-cream-muted/60 pt-1"
            >
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-md hover:text-solomon-gold hover:bg-solomon-graphite/60 transition-colors"
              title="Copiar resposta"
              type="button"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-solomon-gold" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={() => onFeedback?.("up")}
              className={cn(
                "p-1.5 rounded-md hover:bg-solomon-graphite/60 transition-colors",
                message.feedback === "up"
                  ? "text-solomon-gold"
                  : "hover:text-solomon-gold"
              )}
              title="Resposta útil"
              type="button"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onFeedback?.("down")}
              className={cn(
                "p-1.5 rounded-md hover:bg-solomon-graphite/60 transition-colors",
                message.feedback === "down"
                  ? "text-destructive"
                  : "hover:text-destructive"
              )}
              title="Resposta com problema"
              type="button"
            >
              <ThumbsDown className="h-3.5 w-3.5" />
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
            ? "bg-solomon-gold/20 text-solomon-gold border border-solomon-gold/30"
            : "bg-solomon-charcoal text-solomon-cream-muted"
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
      className="group flex flex-col gap-1 px-3 py-2 rounded-md border border-solomon-gold/15 bg-solomon-graphite/40 hover:bg-solomon-graphite hover:border-solomon-gold/30 transition-colors text-xs"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] font-semibold text-solomon-gold bg-solomon-gold/10 px-1.5 py-0.5 rounded">
          {citation.index}
        </span>
        <span className="font-medium text-solomon-cream">
          {citation.insurerName}
        </span>
        <span className="text-solomon-cream-muted/60">·</span>
        <span className="text-solomon-cream-muted flex-1 truncate">
          {citation.productName}
        </span>
        {citation.sourceUrl && (
          <ExternalLink className="h-3 w-3 text-solomon-cream-muted/60 group-hover:text-solomon-gold transition-colors shrink-0" />
        )}
      </div>
      {citation.susepProcess && (
        <span className="font-mono text-[10px] text-solomon-cream-muted/70 pl-7">
          SUSEP {citation.susepProcess}
        </span>
      )}
    </a>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1 px-1">
      <span className="h-1.5 w-1.5 rounded-full bg-solomon-gold animate-pulse [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-solomon-gold animate-pulse [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-solomon-gold animate-pulse" />
    </div>
  );
}
