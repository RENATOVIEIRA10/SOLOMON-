import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Grid, Vignette } from "../components/Grid";
import { useBlinkingCursor, useEnter } from "../motion";
import { outroHandle, outroTagline } from "../script";
import { colors, fonts } from "../theme";

/**
 * Cena 6 — Outro (3s).
 *
 * Encerra com peso, sem CTA imperativo. Wordmark "SOLOMON" em mono,
 * tagline em sans, handle no rodape. Cursor piscando ao lado do
 * wordmark — referencia ao terminal.
 */
export const Scene06Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const wordmarkEnter = useEnter(2, 22);
  const taglineEnter = useEnter(18, 22);
  const handleEnter = useEnter(40, 22);
  const cursorVisible = useBlinkingCursor();

  // Brilho sutil no centro
  const glow = interpolate(frame, [0, 24, 90], [0, 0.18, 0.12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Grid density={64} opacity={0.04} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, rgba(0,200,150,${glow}) 0%, transparent 55%)`,
        }}
      />
      <Vignette />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 60,
        }}
      >
        <div
          style={{
            ...wordmarkEnter,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <span
            style={{
              fontFamily: fonts.mono,
              fontSize: 28,
              color: colors.primary,
              letterSpacing: "0.1em",
            }}
          >
            {">"}
          </span>
          <span
            style={{
              fontFamily: fonts.mono,
              fontSize: 128,
              fontWeight: 700,
              color: colors.ink,
              letterSpacing: "-0.04em",
              lineHeight: 1,
            }}
          >
            solomon
          </span>
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 96,
              marginLeft: 8,
              background: cursorVisible ? colors.primary : "transparent",
            }}
          />
        </div>

        <div
          style={{
            ...taglineEnter,
            fontFamily: fonts.sans,
            fontSize: 44,
            fontWeight: 400,
            color: colors.inkMuted,
            letterSpacing: "-0.02em",
            textAlign: "center",
            maxWidth: 880,
            padding: "0 60px",
            textWrap: "balance",
          }}
        >
          {outroTagline}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 200,
          left: 0,
          right: 0,
          textAlign: "center",
          ...handleEnter,
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 34,
            fontWeight: 500,
            color: colors.primary,
            letterSpacing: "-0.01em",
          }}
        >
          {outroHandle}
        </div>
      </div>
    </AbsoluteFill>
  );
};
