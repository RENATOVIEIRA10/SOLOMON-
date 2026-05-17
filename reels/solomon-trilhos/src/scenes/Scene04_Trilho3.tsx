import { AbsoluteFill } from "remotion";
import { SceneLabel } from "../components/Caption";
import { Grid, Vignette } from "../components/Grid";
import { Terminal } from "../components/Terminal";
import { VerdictCard } from "../components/Verdict";
import { ChatStack, WhatsAppBubble } from "../components/WhatsAppBubble";
import { trilho3Subtitle } from "../script";
import { colors } from "../theme";

/**
 * Cena 4 — Trilho 3: pre-sinistro (7s).
 *
 * Insider sabe: LLM = Sonnet 4.6 (alta consequencia juridica).
 * Output e structured: COBERTO / RISCO / NAO_COBERTO + clausula + checklist.
 *
 * Visual:
 * - Header
 * - Bubble de urgencia (CID, acidente)
 * - Terminal: pre-sinistro.ts + sonnet
 * - 3 cartoes de veredicto (semaforo: verde / ambar / vermelho dessaturado)
 */
export const Scene04Trilho3: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Grid density={64} opacity={0.05} />
      <Vignette />

      <SceneLabel
        text="trilho 3 · pre-sinistro"
        subtitle={trilho3Subtitle}
        delay={0}
      />

      <ChatStack top={320}>
        <WhatsAppBubble variant="in" delay={18} meta="Pedro · urgente">
          cliente caiu de escada em obra propria. CID S72.0. e sinistro?
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
          topLabel="pre-sinistro.ts"
          lines={[
            { kind: "prompt", text: "analyze --policy mag --event ", delay: 4, typewriter: true },
            { kind: "blank" },
            { kind: "kv", key: "evento", value: "fratura femur · obra residencial", delay: 38 },
            { kind: "kv", key: "apolice", value: "MAG vida + IPA", delay: 52 },
            { kind: "kv", key: "cid", value: "S72.0", delay: 62 },
            { kind: "kv", key: "llm", value: "claude-sonnet-4.6", delay: 72, valueColor: colors.warn },
            { kind: "comment", text: "alta consequencia · custo extra ok", delay: 90 },
          ]}
        />
      </div>

      <div
        style={{
          position: "absolute",
          top: 1280,
          left: 80,
          right: 80,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <VerdictCard
          kind="coberto"
          rationale="IPA por fratura — clausula 6.1"
          delay={120}
        />
        <VerdictCard
          kind="risco"
          rationale="obra sem ART pode agravar exclusao 8.3"
          delay={138}
        />
        <VerdictCard
          kind="nao_coberto"
          rationale="perda de renda nao contratada"
          delay={156}
        />
      </div>
    </AbsoluteFill>
  );
};
