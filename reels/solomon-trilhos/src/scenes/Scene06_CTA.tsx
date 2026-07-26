import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Background, GoldGlowLine } from "../components/Background";
import { EditorialHeadline, Eyebrow } from "../components/Caption";
import { useFadeUp } from "../motion";
import {
  ctaDisclaimer,
  ctaEyebrow,
  ctaHandle,
  ctaHeadline,
  footerLogo,
  footerMeta,
} from "../script";
import { colors, fonts, tracking } from "../theme";

/**
 * CENA 6 — CTA (4s).
 *
 * Reproduz .sl-cta da landing:
 *  - Eyebrow "Acesso exclusivo para corretores"
 *  - Headline gigante: "Pronto para provar?" ("provar?" italic gold)
 *  - Botao "Solicitar acesso" estilo .sl-btn-primary (gold solido, uppercase)
 *  - Disclaimer: "Resposta em ate 24h · Sem compromisso · Acesso por convite"
 *  - Wordmark SOLOMON + handle no rodape
 */
export const Scene06CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const ctaEnter = useFadeUp(60, 22);
  const disclaimerEnter = useFadeUp(80, 22);
  const handleEnter = useFadeUp(95, 22);

  // Glow pulse no botao
  const glowIntensity = interpolate(frame, [60, 90, 120], [0, 0.35, 0.25], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Background withParticles />

      <div style={{ position: "absolute", top: 380, left: 0, right: 0 }}>
        <Eyebrow text={ctaEyebrow} delay={4} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 540,
          left: 0,
          right: 0,
          padding: "0 60px",
        }}
      >
        <EditorialHeadline
          before={ctaHeadline.before}
          italicGold={ctaHeadline.italicGold}
          after={ctaHeadline.after}
          delay={20}
          size={148}
        />
      </div>

      {/* Botao */}
      <div
        style={{
          ...ctaEnter,
          position: "absolute",
          top: 980,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            padding: "22px 56px",
            background: colors.gold,
            color: colors.black,
            fontFamily: fonts.mono,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: tracking.button,
            textTransform: "uppercase",
            boxShadow: `0 0 40px rgba(200, 170, 110, ${glowIntensity})`,
          }}
        >
          Solicitar acesso
        </div>
      </div>

      {/* Disclaimer */}
      <div
        style={{
          ...disclaimerEnter,
          position: "absolute",
          top: 1140,
          left: 0,
          right: 0,
          textAlign: "center",
          padding: "0 80px",
          fontFamily: fonts.sans,
          fontSize: 22,
          color: colors.goldDim,
          letterSpacing: "0.08em",
          lineHeight: 1.6,
        }}
      >
        {ctaDisclaimer}
      </div>

      {/* Footer logo */}
      <div
        style={{
          ...handleEnter,
          position: "absolute",
          bottom: 220,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: fonts.serif,
          fontSize: 56,
          fontWeight: 600,
          color: colors.gold,
          letterSpacing: tracking.wordmark,
        }}
      >
        {footerLogo}
      </div>

      {/* Meta */}
      <div
        style={{
          ...handleEnter,
          position: "absolute",
          bottom: 160,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: fonts.sans,
          fontSize: 18,
          color: colors.muted,
          letterSpacing: "0.10em",
        }}
      >
        {footerMeta}
      </div>

      {/* Handle */}
      <div
        style={{
          ...handleEnter,
          position: "absolute",
          bottom: 100,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: fonts.mono,
          fontSize: 24,
          fontWeight: 500,
          color: colors.goldDim,
          letterSpacing: "-0.01em",
        }}
      >
        {ctaHandle}
      </div>
    </AbsoluteFill>
  );
};
