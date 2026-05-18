import { AbsoluteFill } from "remotion";
import { Background, GoldGlowLine } from "../components/Background";
import { Badge, Eyebrow, Subhead, WordReveal } from "../components/Caption";
import { useFadeUp } from "../motion";
import { heroBadge, heroSub, heroWords, footerLogo } from "../script";
import { colors, fonts, tracking } from "../theme";

/**
 * CENA 1 — HERO (6s).
 *
 * Reproduz fielmente o <section .sl-hero> da landing:
 *  - Badge "Seu consultor privado de IA · Seguros de vida"
 *  - Headline word-by-word reveal: "Certeza absoluta. Em segundos."
 *    com "absoluta." italic GOLD
 *  - Sub muted: "Responde com citacao exata..."
 *  - Wordmark SOLOMON discreto no topo (estilo .sl-nav-logo)
 *  - Scroll hint no rodape
 */
export const Scene01Hero: React.FC = () => {
  const wordmarkEnter = useFadeUp(2, 22);
  const subEnter = useFadeUp(78, 22);

  return (
    <AbsoluteFill>
      <Background withParticles />

      {/* Wordmark no topo (.sl-nav-logo) */}
      <div
        style={{
          ...wordmarkEnter,
          position: "absolute",
          top: 110,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: fonts.serif,
          fontSize: 34,
          fontWeight: 600,
          color: colors.gold,
          letterSpacing: tracking.wordmark,
        }}
      >
        {footerLogo}
      </div>

      {/* Badge */}
      <div
        style={{
          position: "absolute",
          top: 460,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Badge text={heroBadge} delay={18} />
      </div>

      {/* Hero title — word reveal */}
      <div
        style={{
          position: "absolute",
          top: 680,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          padding: "0 40px",
        }}
      >
        <WordReveal words={heroWords} baseDelay={36} size={148} />
      </div>

      {/* Sub */}
      <div
        style={{
          ...subEnter,
          position: "absolute",
          top: 1140,
          left: 0,
          right: 0,
          padding: "0 100px",
        }}
      >
        <Subhead text={heroSub} size={32} />
      </div>

      {/* Eyebrow no rodape */}
      <div
        style={{
          position: "absolute",
          bottom: 220,
          left: 0,
          right: 0,
        }}
      >
        <Eyebrow text="prévia por convite" delay={100} />
      </div>

      {/* Scroll hint line */}
      <ScrollHint />
    </AbsoluteFill>
  );
};

const ScrollHint: React.FC = () => {
  const enter = useFadeUp(120, 22);
  return (
    <div
      style={{
        ...enter,
        position: "absolute",
        bottom: 120,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span
        style={{
          fontFamily: fonts.sans,
          fontSize: 16,
          color: colors.muted,
          letterSpacing: "0.25em",
          textTransform: "uppercase",
        }}
      >
        scroll
      </span>
      <div
        style={{
          width: 1,
          height: 50,
          background: `linear-gradient(to bottom, ${colors.goldDim}, transparent)`,
        }}
      />
    </div>
  );
};
