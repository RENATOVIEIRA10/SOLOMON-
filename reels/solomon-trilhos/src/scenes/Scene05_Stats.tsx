import { AbsoluteFill } from "remotion";
import { Background } from "../components/Background";
import { EditorialHeadline, Eyebrow } from "../components/Caption";
import { StatCard } from "../components/Metric";
import { useFadeUp } from "../motion";
import { stats, statsLabel } from "../script";
import { colors, fonts } from "../theme";

/**
 * CENA 5 — STATS (6s).
 *
 * Reproduz .sl-stats da landing:
 *  - 4 stat cards em grid 2x2 (na landing e 1x4, vertical adapta pra 2x2)
 *  - Numeros gigantes Cormorant gold (14+, 16.940, 3s, 24/7)
 *  - Labels uppercase muted abaixo
 *  - Borders dourado-quase-invisivel separando
 */
export const Scene05Stats: React.FC = () => {
  const tagline = useFadeUp(150, 22);

  return (
    <AbsoluteFill>
      <Background withParticles={false} />

      <div style={{ position: "absolute", top: 160, left: 0, right: 0 }}>
        <Eyebrow text={statsLabel} delay={4} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 280,
          left: 0,
          right: 0,
          padding: "0 60px",
        }}
      >
        <EditorialHeadline
          before=""
          italicGold="Provas"
          after=", não promessas."
          delay={18}
          size={108}
        />
      </div>

      {/* Grid 2x2 */}
      <div
        style={{
          position: "absolute",
          top: 700,
          left: 60,
          right: 60,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 1,
          background: colors.border,
          border: `1px solid ${colors.border}`,
          height: 720,
        }}
      >
        <StatCard
          value={stats[0]!.target}
          suffix={stats[0]!.suffix}
          label={"Seguradoras\nindexadas"}
          delay={56}
        />
        <StatCard
          value={stats[1]!.target}
          label={"Cláusulas\nanalisadas"}
          delay={66}
          formatLarge
        />
        <StatCard
          value={stats[2]!.target}
          suffix={stats[2]!.suffix}
          label={"Tempo médio\nde resposta"}
          delay={76}
        />
        <StatCard
          value={stats[3]!.target}
          suffix={stats[3]!.suffix}
          label={"Disponibilidade\ncontínua"}
          delay={86}
        />
      </div>

      <div
        style={{
          ...tagline,
          position: "absolute",
          bottom: 200,
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
            fontSize: 38,
            color: colors.text,
            letterSpacing: "-0.005em",
            lineHeight: 1.4,
          }}
        >
          Não interpreta. Não chuta.{" "}
          <em style={{ color: colors.gold, fontStyle: "italic" }}>Prova.</em>
        </span>
      </div>
    </AbsoluteFill>
  );
};
