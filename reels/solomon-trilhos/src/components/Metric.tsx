import { interpolate, useCurrentFrame } from "remotion";
import { useEnter } from "../motion";
import { colors, fonts } from "../theme";

/**
 * Cartao de metrica Ragas. Numero conta de 0 ate o valor final em ~24 frames.
 * Tons sutis: bom = verde, medio = ambar, baixo = vermelho (saturacao baixa).
 */
export const MetricCard: React.FC<{
  label: string;
  value: number;
  delay?: number;
  /** noise sensitivity e invertida: menor = melhor */
  invert?: boolean;
}> = ({ label, value, delay = 0, invert = false }) => {
  const frame = useCurrentFrame();
  const enter = useEnter(delay, 22);

  const counted = interpolate(frame, [delay + 6, delay + 30], [0, value], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const formatted = counted.toFixed(2);

  // Cor baseada em qualidade
  const quality = invert ? 1 - value : value;
  const color =
    quality >= 0.8
      ? colors.primary
      : quality >= 0.65
        ? colors.warn
        : colors.danger;

  return (
    <div
      style={{
        ...enter,
        background: colors.bgElevated,
        border: `1px solid ${colors.bgPanel}`,
        borderRadius: 16,
        padding: "28px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 20,
          fontWeight: 600,
          color: colors.inkMuted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 72,
          fontWeight: 700,
          color,
          letterSpacing: "-0.04em",
          lineHeight: 1,
        }}
      >
        {formatted}
      </div>
    </div>
  );
};
