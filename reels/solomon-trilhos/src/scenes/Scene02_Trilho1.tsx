import { AbsoluteFill } from "remotion";
import { SceneLabel } from "../components/Caption";
import { Grid, Vignette } from "../components/Grid";
import { Terminal } from "../components/Terminal";
import { ChatStack, WhatsAppBubble } from "../components/WhatsAppBubble";
import { trilho1Subtitle } from "../script";
import { colors } from "../theme";

/**
 * Cena 2 — Trilho 1: cotacao deterministica (7s).
 *
 * O insider sabe: este trilho NAO usa LLM. E lookup direto na tabela
 * de premio do PDF da seguradora. Faithfulness = 1.00 sempre.
 *
 * Visual:
 * - Header: "trilho 1 — cotacao"
 * - WhatsApp bubble do cliente (pergunta real)
 * - Terminal mostrando o lookup deterministico
 * - WhatsApp bubble do SOLOMON com a resposta numerica
 */
export const Scene02Trilho1: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Grid density={64} opacity={0.05} />
      <Vignette />

      <SceneLabel
        text="trilho 1 · cotacao"
        subtitle={trilho1Subtitle}
        delay={0}
      />

      <ChatStack top={320}>
        <WhatsAppBubble variant="in" delay={18} meta="Pedro · 09:42">
          quanto fica 500 mil de morte natural pro meu cliente, 38 anos,
          nao fumante?
        </WhatsAppBubble>
      </ChatStack>

      <div
        style={{
          position: "absolute",
          top: 720,
          left: 80,
          right: 80,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Terminal
          delay={56}
          topLabel="rate-lookup.ts"
          lines={[
            { kind: "prompt", text: "lookup --insurer prudential", delay: 4, typewriter: true },
            { kind: "blank" },
            { kind: "kv", key: "insurer", value: "PRUDENTIAL", delay: 38 },
            { kind: "kv", key: "product", value: "VIDA INDIVIDUAL", delay: 50 },
            { kind: "kv", key: "age", value: "38", delay: 60 },
            { kind: "kv", key: "cover", value: "R$ 500.000", delay: 70 },
            { kind: "blank" },
            { kind: "arrow", text: "premio_mensal = tabela.lookup(...)", delay: 84 },
            { kind: "arrow", text: "R$ 142,80 / mes", delay: 110, color: colors.primary },
            { kind: "comment", text: "F=1.00 — zero LLM, zero chute", delay: 134 },
          ]}
        />
      </div>

      <ChatStack top={1540}>
        <WhatsAppBubble variant="out" delay={158} meta="SOLOMON · agora">
          R$ 142,80/mes na Prudential. valor exato da tabela vigente.
        </WhatsAppBubble>
      </ChatStack>
    </AbsoluteFill>
  );
};
