import { Sequence } from "remotion";
import type { CSSProperties } from "react";
import { colors, fonts } from "../theme";
import { useEnter } from "../motion";
import type { Caption as CaptionType } from "../script";

/**
 * Legendas estilo "kinetic typography" — linha por linha,
 * com letterspacing tight e fade-in escalonado.
 */
export const KineticCaption: React.FC<{
  caption: CaptionType;
  align?: "center" | "left";
  size?: number;
  weight?: number;
  color?: string;
}> = ({
  caption,
  align = "center",
  size = 84,
  weight = 600,
  color = colors.ink,
}) => {
  return (
    <Sequence from={caption.from} durationInFrames={caption.duration}>
      <CaptionInner
        lines={caption.lines}
        align={align}
        size={size}
        weight={weight}
        color={color}
      />
    </Sequence>
  );
};

const CaptionInner: React.FC<{
  lines: string[];
  align: "center" | "left";
  size: number;
  weight: number;
  color: string;
}> = ({ lines, align, size, weight, color }) => {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: align === "center" ? "center" : "flex-start",
        padding: align === "center" ? "0 80px" : "0 80px 0 100px",
        gap: 12,
      }}
    >
      {lines.map((line, i) => (
        <CaptionLine
          key={`${i}-${line}`}
          line={line}
          delay={i * 6}
          align={align}
          size={size}
          weight={weight}
          color={color}
        />
      ))}
    </div>
  );
};

const CaptionLine: React.FC<{
  line: string;
  delay: number;
  align: "center" | "left";
  size: number;
  weight: number;
  color: string;
}> = ({ line, delay, align, size, weight, color }) => {
  const enter = useEnter(delay, 18);

  const style: CSSProperties = {
    ...enter,
    fontFamily: fonts.display,
    fontSize: size,
    fontWeight: weight,
    color,
    letterSpacing: "-0.03em",
    lineHeight: 1.05,
    textAlign: align,
    textWrap: "balance",
  };

  return <div style={style}>{line}</div>;
};

/**
 * Pequena etiqueta de cena no topo. "trilho 1 — cotacao".
 */
export const SceneLabel: React.FC<{
  text: string;
  subtitle?: string;
  delay?: number;
}> = ({ text, subtitle, delay = 0 }) => {
  const enter = useEnter(delay, 20);
  return (
    <div
      style={{
        ...enter,
        position: "absolute",
        top: 120,
        left: 80,
        right: 80,
      }}
    >
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 26,
          fontWeight: 500,
          color: colors.inkMuted,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {text}
      </div>
      {subtitle && (
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 32,
            fontWeight: 500,
            color: colors.ink,
            marginTop: 12,
            letterSpacing: "-0.02em",
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
};
