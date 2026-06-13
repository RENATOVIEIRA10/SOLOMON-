"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "motion/react";
import { FileSearch, Sparkles } from "lucide-react";
import { useBrokerId } from "@/hooks/use-broker-id";
import { MessageBubble, type ChatMessage, type Citation } from "./message";
import { ChatInput } from "./chat-input";
import { HistoryDrawer } from "./history-drawer";

const SUGGESTIONS = [
  "O que é IPA majorada e como funciona?",
  "Qual a carência para morte por doença em apólice de vida individual?",
  "Quando a contestabilidade expira em um seguro de vida?",
];

export function ChatView() {
  const brokerId = useBrokerId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [insurer, setInsurer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (text.length < 3 || loading) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      const loadingMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        loading: true,
      };

      setMessages((m) => [...m, userMsg, loadingMsg]);
      setInput("");
      setLoading(true);

      try {
        const history = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const res = await fetch("/api/ask/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: text,
            insurer: insurer ?? undefined,
            channel: "dashboard",
            history,
          }),
        });

        if (!res.ok || !res.body) {
          let errText = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) errText = body.error;
          } catch {
            // ignore
          }
          throw new Error(errText);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        let started = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const raw of events) {
            if (!raw.trim()) continue;
            let eventName = "";
            let dataLine = "";
            for (const line of raw.split("\n")) {
              if (line.startsWith("event: ")) eventName = line.slice(7).trim();
              else if (line.startsWith("data: "))
                dataLine = line.slice(6).trim();
            }
            if (!eventName || !dataLine) continue;
            let payload: unknown;
            try {
              payload = JSON.parse(dataLine);
            } catch {
              continue;
            }

            if (eventName === "token") {
              const delta = (payload as { delta: string }).delta ?? "";
              fullText += delta;
              if (!started) {
                started = true;
                setMessages((m) =>
                  m.map((msg) =>
                    msg.id === loadingMsg.id
                      ? { ...msg, loading: false, content: fullText }
                      : msg
                  )
                );
              } else {
                setMessages((m) =>
                  m.map((msg) =>
                    msg.id === loadingMsg.id ? { ...msg, content: fullText } : msg
                  )
                );
              }
            } else if (eventName === "meta") {
              const meta = payload as {
                citations: Citation[];
                conversationId?: string;
                confidenceScore?: number;
                lowConfidence?: boolean;
                answerWarnings?: string[];
              };
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === loadingMsg.id
                    ? {
                        ...msg,
                        loading: false,
                        citations: meta.citations,
                        conversationId: meta.conversationId,
                        confidenceScore: meta.confidenceScore,
                        lowConfidence: meta.lowConfidence,
                        answerWarnings: meta.answerWarnings,
                      }
                    : msg
                )
              );
            } else if (eventName === "error") {
              const errMsg =
                (payload as { message: string }).message ?? "Erro no stream.";
              throw new Error(errMsg);
            }
          }
        }
      } catch (err) {
        const errorText =
          err instanceof Error
            ? err.message
            : "Erro inesperado. Tente novamente.";
        setMessages((m) =>
          m.map((msg) =>
            msg.id === loadingMsg.id
              ? {
                  ...msg,
                  loading: false,
                  content: `⚠️ ${errorText}`,
                }
              : msg
          )
        );
      } finally {
        setLoading(false);
      }
    },
    [insurer, loading, messages]
  );

  const handleFeedback = useCallback(
    async (messageId: string, rating: "up" | "down") => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg?.conversationId || !brokerId) return;

      setMessages((m) =>
        m.map((x) => (x.id === messageId ? { ...x, feedback: rating } : x))
      );

      try {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: msg.conversationId,
            rating: rating === "up" ? 5 : 1,
            channel: "dashboard",
          }),
        });
      } catch (e) {
        console.warn("feedback failed", e);
      }
    },
    [brokerId, messages]
  );

  const hasMessages = messages.length > 0;

  return (
    // Sem max-h-dvh: o <main> pai (flex-1, com pt do header + pb-24 do
    // bottom-nav) já define a caixa. Um 100dvh aqui — num container já
    // deslocado pela altura do header — transbordaria a viewport e empurraria
    // a top-bar/input para fora. min-h-0 preserva o scroll interno das mensagens.
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar */}
      <div className="safe-top px-4 md:px-6 pb-3 flex items-center justify-between gap-3 border-b border-solomon-gold/10 bg-background/70 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-solomon-gold/10 text-solomon-gold">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-lg text-solomon-cream">
              SOLOMON
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-solomon-gold/70">
              Consultor privado
            </span>
          </div>
        </div>
        <HistoryDrawer
          brokerId={brokerId}
          onSelect={(item) => {
            setMessages([
              { id: crypto.randomUUID(), role: "user", content: item.message },
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: item.response,
              },
            ]);
          }}
        />
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 md:px-6 py-6"
      >
        {!hasMessages ? (
          <EmptyState onPick={send} />
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-5">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onFeedback={(rating) => handleFeedback(m.id, rating)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="safe-bottom px-4 md:px-6 pt-2 pb-3 border-t border-solomon-gold/10 bg-background/95 backdrop-blur-md sticky bottom-0">
        <div className="max-w-3xl mx-auto">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={() => send(input)}
            loading={loading}
            insurer={insurer}
            onInsurerChange={setInsurer}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center"
      >
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-solomon-gold/10 text-solomon-gold mb-6">
          <FileSearch className="h-7 w-7" />
        </div>
        <h1 className="font-display text-3xl md:text-4xl text-solomon-cream">
          Como posso ajudar?
        </h1>
        <p className="mt-3 text-sm text-solomon-cream-muted max-w-md">
          Pergunte sobre condições gerais, coberturas, carências, exclusões de
          qualquer seguradora indexada.
        </p>

        <div className="mt-10 w-full flex flex-col gap-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-solomon-gold/70 mb-1 text-left">
            Sugestões
          </p>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="text-left px-4 py-3 rounded-lg border border-solomon-gold/15 bg-solomon-graphite/40 hover:border-solomon-gold/40 hover:bg-solomon-graphite transition-colors text-sm text-solomon-cream"
            >
              {s}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
