import { useCountUp, useFadeUp } from "../motion";
import { colors, fonts } from "../theme";

/**
 * Stat card — reproduz .sl-stat-card da landing real.
 *
 * Mudancas em relacao a versao antiga (Ragas):
 *  - Numero gigante em Cormorant Garamond 300, GOLD (#C8AA6E)
 *  - Suffix em gold-dim, tamanho ~50% do numero
 *  - Label uppercase, sans, muted, letterspacing 0.10em
 *  - Background SURFACE (#0c0c12), border 1px gold-dim
 *  - SEM cor por qualidade (era inadequado pra metrica de eval interna)
 */
export const StatCard: React.FC<{
  value: number;
  suffix?: string;
  label: string;
  delay?: number;
  formatLarge?: boolean;
}> = ({ value, suffix, label, delay = 0, formatLarge }) => {
  const enter = useFadeUp(delay, 22);
  const counted = useCountUp(value, delay + 6, value > 1000 ? 60 : 36);
  const formatted = formatLarge ? counted.toLocaleString("pt-BR") : `${counted}`;

  return (
    <div
      style={{
        ...enter,
        padding: "44px 32px",
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        height: "100%",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily: fonts.serif,
          fontSize: 96,
          fontWeight: 300,
          color: colors.gold,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "center",
        }}
      >
        <span>{formatted}</span>
        {suffix && (
          <span
            style={{
              fontSize: 56,
              color: colors.goldDim,
              marginLeft: 4,
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: fonts.sans,
          fontSize: 18,
          color: colors.muted,
          letterSpacing: "0.10em",
          lineHeight: 1.5,
          textTransform: "uppercase",
          fontWeight: 500,
          whiteSpace: "pre-line",
        }}
      >
        {label}
      </div>
    </div>
  );
};
