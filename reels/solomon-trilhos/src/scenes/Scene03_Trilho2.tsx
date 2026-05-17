import { AbsoluteFill } from "remotion";
import { SceneLabel } from "../components/Caption";
import { Grid, Vignette } from "../components/Grid";
import { InsurerTicker } from "../components/InsurerStrip";
import { Terminal } from "../components/Terminal";
import { ChatStack, WhatsAppBubble } from "../components/WhatsAppBubble";
import { trilho2Subtitle } from "../script";
import { colors } from "../theme";

/**
 * Cena 3 — Trilho 2: oraculo (7s).
 *
 * O insider sabe: trilho 2 e RAG vanilla sobre 15 contratos diferentes,
 * com citacao de pagina. LLM = Haiku 4.5. Custo otimizado, latencia
 * aceitavel pra WhatsApp.
 *
 * Visual:
 * - Header
 * - Bubble pergunta livre
 * - Terminal mostrando pipeline RAG (retrieval + bm25 + 8 chunks + haiku)
 * - Strip horizontal das 15 seguradoras se movendo (ticker)
 * - Bubble resposta COM CITACAO (esse e o diferencial)
 */
export const Scene03Trilho2: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Grid density={64} opacity={0.05} />
      <Vignette />

      <SceneLabel
        text="trilho 2 · oraculo"
        subtitle={trilho2Subtitle}
        delay={0}
      />

      <ChatStack top={320}>
        <WhatsAppBubble variant="in" delay={18} meta="Pedro · 14:08">
          acidente em moto está coberto na apolice da minha cliente?
        </WhatsAppBubble>
      </ChatStack>

      <div
        style={{
          position: "absolute",
          top: 680,
          left: 80,
          right: 80,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Terminal
          delay={56}
          topLabel="rag/answer.ts"
          lines={[
            { kind: "prompt", text: "answer --scope apolice_cliente", delay: 4, typewriter: true },
            { kind: "blank" },
            { kind: "kv", key: "retrieval", value: "pgvector + bm25", delay: 40 },
            { kind: "kv", key: "rerank", value: "cohere-pt", delay: 52 },
            { kind: "kv", key: "context", value: "8 chunks", delay: 62 },
            { kind: "kv", key: "llm", value: "claude-haiku-4.5", delay: 72 },
            { kind: "blank" },
            { kind: "arrow", text: "clausula 4.2 — p.47", delay: 90, color: colors.primary },
            { kind: "arrow", text: "exclusao 4.7 — p.89", delay: 108, color: colors.warn },
          ]}
        />
      </div>

      <InsurerTicker top={1300} delay={60} speedPxPerFrame={3.6} />

      <ChatStack top={1480}>
        <WhatsAppBubble variant="out" delay={148} meta="SOLOMON · agora">
          sim. Bradesco Vida, clausula 4.2 (p.47). exclui se conduzir
          sem CNH categoria A — clausula 4.7 (p.89).
        </WhatsAppBubble>
      </ChatStack>
    </AbsoluteFill>
  );
};
