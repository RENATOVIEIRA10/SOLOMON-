import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { KineticCaption } from "../components/Caption";
import { Grid, Vignette } from "../components/Grid";
import { hookCaptions } from "../script";
import { colors, fonts } from "../theme";

/**
 * Cena 1 — Hook (5s).
 *
 * Estabelece o problema sem usar "IA".
 * 3 batidas: "15 seguradoras" / "200 paginas" / "30 segundos".
 *
 * Visual: tela predominantemente preta com grid sutil. No fundo, um
 * "carimbo" monoespacado de timestamp que da a sensacao de log/realidade,
 * nao de marketing.
 */
export const Scene01Hook: React.FC = () => {
  const frame = useCurrentFrame();

  // Pulse muito sutil no fundo — quase imperceptivel, da textura
  const bgPulse = interpolate(frame % 60, [0, 30, 60], [0, 0.04, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Grid density={56} opacity={0.06} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, rgba(0,200,150,${bgPulse}) 0%, transparent 60%)`,
        }}
      />
      <Vignette />

      <div
        style={{
          position: "absolute",
          top: 120,
          left: 80,
          fontFamily: fonts.mono,
          fontSize: 20,
          color: colors.inkMuted,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
        }}
      >
        $ solomon --status
      </div>

      <KineticCaption
        caption={hookCaptions[0]!}
        size={120}
        color={colors.ink}
      />
      <KineticCaption
        caption={hookCaptions[1]!}
        size={96}
        color={colors.ink}
      />
      <KineticCaption
        caption={hookCaptions[2]!}
        size={108}
        color={colors.primary}
      />

      <div
        style={{
          position: "absolute",
          bottom: 140,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: fonts.mono,
          fontSize: 18,
          color: colors.inkDim,
          letterSpacing: "0.1em",
        }}
      >
        SOLOMON · CORRETOR-FIRST
      </div>
    </AbsoluteFill>
  );
};
