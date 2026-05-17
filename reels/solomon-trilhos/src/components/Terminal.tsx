import type { CSSProperties } from "react";
import { useBlinkingCursor, useEnter, useTypewriter } from "../motion";
import { colors, fonts } from "../theme";

/**
 * Bloco terminal-style. Headerless por padrao (so o filete da janela).
 * Cada linha pode ser typewriter ou estatica.
 */
export type TerminalLine =
  | { kind: "prompt"; text: string; delay?: number; typewriter?: boolean }
  | { kind: "kv"; key: string; value: string; delay?: number; valueColor?: string }
  | { kind: "arrow"; text: string; delay?: number; color?: string }
  | { kind: "blank"; delay?: number }
  | { kind: "comment"; text: string; delay?: number };

export const Terminal: React.FC<{
  lines: TerminalLine[];
  width?: number;
  delay?: number;
  topLabel?: string;
  cursorOnLast?: boolean;
}> = ({ lines, width = 900, delay = 0, topLabel, cursorOnLast = true }) => {
  const enter = useEnter(delay, 24);

  return (
    <div
      style={{
        ...enter,
        width,
        background: colors.bgElevated,
        border: `1px solid ${colors.bgPanel}`,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
      }}
    >
      <TerminalHeader label={topLabel ?? "solomon"} />
      <div
        style={{
          padding: "28px 32px 30px",
          fontFamily: fonts.mono,
          fontSize: 24,
          lineHeight: 1.55,
          letterSpacing: 0,
        }}
      >
        {lines.map((line, i) => (
          <TerminalLineRenderer
            key={i}
            line={line}
            isLast={i === lines.length - 1}
            cursorOnLast={cursorOnLast}
            baseDelay={delay}
          />
        ))}
      </div>
    </div>
  );
};

const TerminalHeader: React.FC<{ label: string }> = ({ label }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "16px 24px",
        background: colors.bgPanel,
        borderBottom: `1px solid ${colors.bg}`,
      }}
    >
      <Dot color="#FF5F57" />
      <Dot color="#FFBD2E" />
      <Dot color="#28CA42" />
      <div
        style={{
          marginLeft: 16,
          fontFamily: fonts.mono,
          fontSize: 18,
          color: colors.inkMuted,
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
    </div>
  );
};

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <div
    style={{
      width: 14,
      height: 14,
      borderRadius: 7,
      background: color,
      opacity: 0.85,
    }}
  />
);

const TerminalLineRenderer: React.FC<{
  line: TerminalLine;
  isLast: boolean;
  cursorOnLast: boolean;
  baseDelay: number;
}> = ({ line, isLast, cursorOnLast, baseDelay }) => {
  // Hooks SEMPRE no topo, na mesma ordem. Rules of Hooks.
  const delay = (line.kind !== "blank" ? (line.delay ?? 0) : 0) + baseDelay;
  const cursorVisible = useBlinkingCursor();

  // Texto-alvo do typewriter, em funcao do kind. String vazia para blank.
  const targetText = (() => {
    switch (line.kind) {
      case "prompt":
        return line.text;
      case "kv":
        return line.value;
      case "arrow":
      case "comment":
        return line.text;
      case "blank":
        return "";
    }
  })();

  // Typewriter rapido se o autor pediu nao-tipado (kind=prompt + typewriter=false).
  const speed = line.kind === "prompt" && !line.typewriter ? 9999 : 1.4;
  const visible = useTypewriter(targetText, delay, speed);

  switch (line.kind) {
    case "prompt":
      return (
        <div style={lineStyle}>
          <span style={{ color: colors.primary, marginRight: 12 }}>{">"}</span>
          <span style={{ color: colors.ink }}>{visible}</span>
          {isLast && cursorOnLast && (
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 24,
                marginLeft: 6,
                verticalAlign: "middle",
                background: cursorVisible ? colors.primary : "transparent",
              }}
            />
          )}
        </div>
      );
    case "kv":
      return (
        <div style={lineStyle}>
          <span
            style={{
              color: colors.inkMuted,
              marginLeft: 26,
              marginRight: 14,
              minWidth: 180,
              display: "inline-block",
            }}
          >
            {line.key}
          </span>
          <span style={{ color: line.valueColor ?? colors.ink }}>{visible}</span>
        </div>
      );
    case "arrow":
      return (
        <div style={lineStyle}>
          <span
            style={{
              color: line.color ?? colors.primary,
              marginLeft: 14,
              marginRight: 8,
            }}
          >
            {"→"}
          </span>
          <span style={{ color: line.color ?? colors.ink }}>{visible}</span>
        </div>
      );
    case "comment":
      return (
        <div style={lineStyle}>
          <span style={{ color: colors.inkDim }}>{`// ${visible}`}</span>
        </div>
      );
    case "blank":
      return <div style={{ height: 12 }} />;
  }
};

const lineStyle: CSSProperties = {
  display: "block",
  whiteSpace: "pre",
};
