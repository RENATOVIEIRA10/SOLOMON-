import { useEnter } from "../motion";
import { colors, fonts } from "../theme";

/**
 * Cartoes de veredicto do pre-sinistro: COBERTO / RISCO / NAO_COBERTO.
 * Cores semanticas mas dessaturadas — nao parecer dashboard de e-commerce.
 */

type VerdictKind = "coberto" | "risco" | "nao_coberto";

const VERDICT_META: Record<
  VerdictKind,
  { label: string; mark: string; color: string; bg: string; border: string }
> = {
  coberto: {
    label: "COBERTO",
    mark: "✓",
    color: colors.primary,
    bg: "rgba(0,200,150,0.08)",
    border: "rgba(0,200,150,0.32)",
  },
  risco: {
    label: "RISCO",
    mark: "!",
    color: colors.warn,
    bg: "rgba(242,180,65,0.08)",
    border: "rgba(242,180,65,0.32)",
  },
  nao_coberto: {
    label: "NAO COBERTO",
    mark: "✕",
    color: colors.danger,
    bg: "rgba(229,72,77,0.07)",
    border: "rgba(229,72,77,0.28)",
  },
};

export const VerdictCard: React.FC<{
  kind: VerdictKind;
  rationale: string;
  delay?: number;
}> = ({ kind, rationale, delay = 0 }) => {
  const enter = useEnter(delay, 22);
  const meta = VERDICT_META[kind];

  return (
    <div
      style={{
        ...enter,
        display: "flex",
        alignItems: "center",
        gap: 22,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        borderRadius: 14,
        padding: "20px 26px",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: meta.color,
          color: "#03110D",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: fonts.mono,
          fontSize: 32,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {meta.mark}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 20,
            fontWeight: 600,
            color: meta.color,
            letterSpacing: "0.1em",
          }}
        >
          {meta.label}
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 26,
            color: colors.ink,
            letterSpacing: "-0.01em",
          }}
        >
          {rationale}
        </div>
      </div>
    </div>
  );
};
