import type { CSSProperties } from "react";
import { colors, fonts, tracking } from "../theme";
import { useFadeUp } from "../motion";

/**
 * Componentes editoriais SOLOMON.
 *
 * Padroes da landing (.sl-* tokens):
 *  - eyebrow/section-label: mono OU sans, uppercase, letterspacing 0.30em
 *  - section-title:         Cormorant 300, italic gold em palavras-chave
 *  - badge:                 mono, uppercase, border dourado-dim 1px, padding 6×16
 */

/** Eyebrow (label de secao acima do titulo). Estilo .sl-section-label / .sl-cta-eyebrow */
export const Eyebrow: React.FC<{
  text: string;
  delay?: number;
  align?: "left" | "center";
  color?: string;
}> = ({ text, delay = 0, align = "center", color }) => {
  const enter = useFadeUp(delay, 22);
  return (
    <div
      style={{
        ...enter,
        fontFamily: fonts.sans,
        fontSize: 22,
        fontWeight: 500,
        color: color ?? colors.goldDim,
        letterSpacing: tracking.eyebrow,
        textTransform: "uppercase",
        textAlign: align,
      }}
    >
      {text}
    </div>
  );
};

/** Badge com border dourada-dim. Estilo .sl-hero-badge / .sl-pillar-status */
export const Badge: React.FC<{
  text: string;
  delay?: number;
  color?: string;
  borderColor?: string;
}> = ({ text, delay = 0, color, borderColor }) => {
  const enter = useFadeUp(delay, 22);
  return (
    <div
      style={{
        ...enter,
        display: "inline-block",
        fontFamily: fonts.sans,
        fontSize: 20,
        fontWeight: 500,
        color: color ?? colors.goldDim,
        letterSpacing: tracking.badge,
        textTransform: "uppercase",
        padding: "10px 22px",
        border: `1px solid ${borderColor ?? colors.goldDim}`,
        borderRadius: 2,
      }}
    >
      {text}
    </div>
  );
};

/**
 * Section title — Cormorant 300, gigantesco, italic gold em palavras-chave.
 * Estilo .sl-section-title (com <em> dentro).
 */
export const EditorialHeadline: React.FC<{
  before?: string;
  italicGold: string;
  after?: string;
  delay?: number;
  size?: number;
  align?: "left" | "center";
}> = ({ before, italicGold, after, delay = 0, size = 132, align = "center" }) => {
  const enter = useFadeUp(delay, 24);
  const style: CSSProperties = {
    ...enter,
    fontFamily: fonts.serif,
    fontSize: size,
    fontWeight: 300,
    color: colors.text,
    letterSpacing: tracking.tightSerif,
    lineHeight: 1.05,
    textAlign: align,
    whiteSpace: "pre-line",
  };
  return (
    <div style={style}>
      {before}
      <em
        style={{
          fontStyle: "italic",
          color: colors.gold,
          fontWeight: 400,
        }}
      >
        {italicGold}
      </em>
      {after}
    </div>
  );
};

/** Subtitulo discreto, sans cinza, abaixo do titulo */
export const Subhead: React.FC<{
  text: string;
  delay?: number;
  size?: number;
}> = ({ text, delay = 0, size = 30 }) => {
  const enter = useFadeUp(delay, 22);
  return (
    <div
      style={{
        ...enter,
        fontFamily: fonts.sans,
        fontSize: size,
        fontWeight: 400,
        color: colors.muted,
        lineHeight: 1.7,
        textAlign: "center",
        letterSpacing: "-0.005em",
        whiteSpace: "pre-line",
      }}
    >
      {text}
    </div>
  );
};

/** Word-by-word reveal — usado no hero (.sl-hero-title .sl-word) */
export const WordReveal: React.FC<{
  words: { text: string; gold?: boolean; lineBreakAfter?: boolean }[];
  baseDelay?: number;
  size?: number;
}> = ({ words, baseDelay = 0, size = 152 }) => {
  // Quebra em linhas com base em lineBreakAfter
  const lines: typeof words[] = [[]];
  words.forEach((w) => {
    lines[lines.length - 1]!.push(w);
    if (w.lineBreakAfter) lines.push([]);
  });

  let wordIdx = 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {lines.map((line, lineIdx) =>
        line.length === 0 ? null : (
          <div
            key={lineIdx}
            style={{
              display: "flex",
              gap: "0.22em",
              overflow: "hidden",
              alignItems: "baseline",
            }}
          >
            {line.map((w, wIdx) => {
              const idx = wordIdx++;
              return (
                <Word
                  key={`${lineIdx}-${wIdx}`}
                  text={w.text}
                  gold={w.gold}
                  delay={baseDelay + idx * 7}
                  size={size}
                />
              );
            })}
          </div>
        ),
      )}
    </div>
  );
};

const Word: React.FC<{
  text: string;
  gold?: boolean;
  delay: number;
  size: number;
}> = ({ text, gold, delay, size }) => {
  const enter = useFadeUp(delay, 21);
  // Word in usa translateY maior — sobrescreve
  const customStyle: CSSProperties = {
    opacity: enter.opacity,
    transform: enter.transform.replace(/translateY\(\d+\.?\d*px\)/, (m) => {
      const px = parseFloat(m.match(/[-\d.]+/)![0]);
      return `translateY(${px * 2.5}px)`;
    }),
    display: "inline-block",
    fontFamily: fonts.serif,
    fontSize: size,
    fontWeight: gold ? 400 : 300,
    fontStyle: gold ? "italic" : "normal",
    color: gold ? colors.gold : colors.text,
    letterSpacing: tracking.tightSerif,
    lineHeight: 1,
  };
  return <span style={customStyle}>{text}</span>;
};
