import { useFadeUp } from "../motion";
import { colors, fonts } from "../theme";

/**
 * Badge row do pre-sinistro — reproduz fielmente .sl-badge-row + .sl-badge-dot
 * da landing real.
 *
 * Cada linha:
 *  - dot 8px colorido (verde/amarelo/vermelho)
 *  - texto sans 22px cor muted
 *
 * NAO usar cards grandes coloridos (era erro do reel antigo). A landing
 * usa linhas simples — mais sobrio, mais luxury.
 */

const DOT_COLORS = {
  green: colors.live,
  yellow: colors.warn,
  red: colors.danger,
} as const;

export const BadgeRow: React.FC<{
  kind: "green" | "yellow" | "red";
  text: string;
  delay?: number;
}> = ({ kind, text, delay = 0 }) => {
  const enter = useFadeUp(delay, 20);
  return (
    <div
      style={{
        ...enter,
        display: "flex",
        alignItems: "center",
        gap: 18,
        fontFamily: fonts.sans,
        fontSize: 28,
        color: colors.text,
        lineHeight: 1.5,
        letterSpacing: "-0.005em",
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          backgroundColor: DOT_COLORS[kind],
          flexShrink: 0,
          boxShadow: `0 0 12px ${DOT_COLORS[kind]}44`,
        }}
      />
      <span>{text}</span>
    </div>
  );
};
