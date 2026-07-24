import { AbsoluteFill } from "remotion";
import { Background, GoldGlowLine } from "../components/Background";
import { EditorialHeadline, Eyebrow } from "../components/Caption";
import { BadgeRow } from "../components/Verdict";
import { useFadeUp } from "../motion";
import {
  preSinistroBadges,
  preSinistroHeadline,
  preSinistroLabel,
} from "../script";
import { colors, fonts } from "../theme";

/**
 * CENA 3 — PRE-SINISTRO (6s).
 *
 * Reproduz o card "02 Pre-Sinistro" da landing:
 *  - Eyebrow "02 · PRE-SINISTRO"
 *  - Headline: "Antes do sinistro abrir, voce ja sabe."
 *    ("sinistro abrir," italic gold)
 *  - Lista de badges com dots verdes/amarelos/vermelhos
 *  - Subline "Veredicto, checklist, risk flags"
 */
export const Scene03PreSinistro: React.FC = () => {
  const cardEnter = useFadeUp(60, 24);
  const sublineEnter = useFadeUp(150, 22);

  return (
    <AbsoluteFill>
      <Background withParticles={false} />

      <div style={{ position: "absolute", top: 140, left: 0, right: 0 }}>
        <Eyebrow text={preSinistroLabel} delay={4} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 240,
          left: 0,
          right: 0,
          padding: "0 60px",
        }}
      >
        <EditorialHeadline
          before={preSinistroHeadline.before}
          italicGold={preSinistroHeadline.italicGold}
          after={preSinistroHeadline.after}
          delay={18}
          size={102}
        />
      </div>

      {/* Card containing badges */}
      <div
        style={{
          ...cardEnter,
          position: "absolute",
          top: 720,
          left: 80,
          right: 80,
          padding: "56px 60px",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 18,
            color: colors.goldDim,
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            marginBottom: 36,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span>checklist · ao vivo</span>
          <div
            style={{
              flex: 1,
              height: 1,
              background: colors.border,
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {preSinistroBadges.map((b, i) => (
            <BadgeRow
              key={i}
              kind={b.kind}
              text={b.text}
              delay={72 + i * 8}
            />
          ))}
        </div>
      </div>

      {/* Subline */}
      <div
        style={{
          ...sublineEnter,
          position: "absolute",
          bottom: 200,
          left: 0,
          right: 0,
          textAlign: "center",
          padding: "0 80px",
        }}
      >
        <div
          style={{
            fontFamily: fonts.serif,
            fontStyle: "italic",
            fontSize: 32,
            color: colors.muted,
            lineHeight: 1.5,
          }}
        >
          Veredicto, checklist e risk flags
          <br />
          antes do segurado abrir aviso.
        </div>
      </div>
    </AbsoluteFill>
  );
};
