import { AbsoluteFill } from "remotion";
import { Background } from "../components/Background";
import { EditorialHeadline, Eyebrow } from "../components/Caption";
import { ComparatorTable } from "../components/ComparatorTable";
import { InsurerTicker } from "../components/InsurerStrip";
import { useFadeUp } from "../motion";
import {
  comparadorHeadline,
  comparadorLabel,
  comparadorTable,
} from "../script";
import { colors, fonts } from "../theme";

/**
 * CENA 4 — COMPARADOR (6s).
 *
 * Reproduz o card "03 Comparador" da landing:
 *  - Eyebrow "03 · COMPARADOR"
 *  - Headline: "Lado a lado. Onde voce e superior." (italic gold em "superior.")
 *  - Tabela Prudential x MAG com 3 criterios
 *  - Ticker de seguradoras (.sl-ticker) embaixo
 */
export const Scene04Comparador: React.FC = () => {
  const note = useFadeUp(146, 22);

  return (
    <AbsoluteFill>
      <Background withParticles={false} />

      <div style={{ position: "absolute", top: 140, left: 0, right: 0 }}>
        <Eyebrow text={comparadorLabel} delay={4} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 230,
          left: 0,
          right: 0,
          padding: "0 60px",
        }}
      >
        <EditorialHeadline
          before={comparadorHeadline.before}
          italicGold={comparadorHeadline.italicGold}
          after={comparadorHeadline.after}
          delay={18}
          size={102}
        />
      </div>

      <div
        style={{
          position: "absolute",
          top: 660,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          padding: "0 50px",
        }}
      >
        <ComparatorTable rows={comparadorTable} delay={60} width={960} />
      </div>

      {/* Nota italic */}
      <div
        style={{
          ...note,
          position: "absolute",
          top: 1120,
          left: 0,
          right: 0,
          textAlign: "center",
          padding: "0 80px",
        }}
      >
        <span
          style={{
            fontFamily: fonts.serif,
            fontStyle: "italic",
            fontSize: 28,
            color: colors.goldDim,
            letterSpacing: "0.04em",
          }}
        >
          dados, nao opinião.
        </span>
      </div>

      {/* Ticker — 14 seguradoras reais */}
      <InsurerTicker top={1380} delay={70} speedPxPerFrame={1.4} />
    </AbsoluteFill>
  );
};
