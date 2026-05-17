import { AbsoluteFill } from "remotion";
import { Grid, Vignette } from "../components/Grid";
import { MetricCard } from "../components/Metric";
import { useEnter } from "../motion";
import {
  evalFooterPrimary,
  evalFooterSecondary,
  evalHeadline,
  evalSubheadline,
} from "../script";
import { colors, fonts } from "../theme";

/**
 * Cena 5 — Eval (6s).
 *
 * Insider sabe: SOLOMON tem 49 perguntas validadas por Julio (corretor
 * ancora), 5 metricas Ragas (F, AC, CP, CR, NS) e roda em ensemble
 * Gemini+Haiku quando precisa. Esta cena PROVA que nao e demo.
 *
 * Visual:
 * - Headline "49 perguntas."
 * - Sub "1 corretor validou cada uma."
 * - Grid 5 colunas de metricas (numeros contam de 0 ate o valor real)
 * - Pe: "5 metricas. 3 modelos. Nenhum chute em producao."
 */
export const Scene05Eval: React.FC = () => {
  const headEnter = useEnter(8, 22);
  const subEnter = useEnter(20, 22);
  const footEnter = useEnter(110, 22);

  // Valores baseados no scoreboard publico do STATUS.md.
  // Sao representativos, nao live. Atualizar conforme metric drift.
  const metrics = [
    { label: "F", value: 0.92, invert: false, delay: 50 },
    { label: "AC", value: 0.84, invert: false, delay: 60 },
    { label: "CP", value: 0.79, invert: false, delay: 70 },
    { label: "CR", value: 0.81, invert: false, delay: 80 },
    { label: "NS", value: 0.06, invert: true, delay: 90 },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Grid density={64} opacity={0.05} />
      <Vignette />

      <div
        style={{
          position: "absolute",
          top: 280,
          left: 80,
          right: 80,
          textAlign: "center",
        }}
      >
        <div
          style={{
            ...headEnter,
            fontFamily: fonts.display,
            fontSize: 140,
            fontWeight: 700,
            color: colors.ink,
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          {evalHeadline}
        </div>
        <div
          style={{
            ...subEnter,
            marginTop: 24,
            fontFamily: fonts.sans,
            fontSize: 44,
            fontWeight: 400,
            color: colors.inkMuted,
            letterSpacing: "-0.02em",
          }}
        >
          {evalSubheadline}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: 820,
          left: 60,
          right: 60,
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
        }}
      >
        {metrics.map((m) => (
          <MetricCard
            key={m.label}
            label={m.label}
            value={m.value}
            delay={m.delay}
            invert={m.invert}
          />
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          top: 1180,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <RagasLegend delay={104} />
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 280,
          left: 80,
          right: 80,
          textAlign: "center",
          ...footEnter,
        }}
      >
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 56,
            fontWeight: 600,
            color: colors.ink,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
          }}
        >
          {evalFooterPrimary}
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: fonts.display,
            fontSize: 52,
            fontWeight: 500,
            color: colors.primary,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          {evalFooterSecondary}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 120,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: fonts.mono,
          fontSize: 18,
          color: colors.inkDim,
          letterSpacing: "0.12em",
        }}
      >
        JULIO · CORRETOR HA 22 ANOS · CLIENTE-ANCORA
      </div>
    </AbsoluteFill>
  );
};

const RagasLegend: React.FC<{ delay: number }> = ({ delay }) => {
  const enter = useEnter(delay, 18);
  return (
    <div
      style={{
        ...enter,
        display: "flex",
        gap: 28,
        fontFamily: fonts.mono,
        fontSize: 18,
        color: colors.inkMuted,
        letterSpacing: "0.06em",
      }}
    >
      <span>F = faithfulness</span>
      <span>AC = correctness</span>
      <span>CP = precision</span>
      <span>CR = recall</span>
      <span>NS = noise</span>
    </div>
  );
};
