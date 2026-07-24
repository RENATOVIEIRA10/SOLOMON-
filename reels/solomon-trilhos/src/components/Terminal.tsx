import type { CSSProperties } from "react";
import { useBlinkingCursor, useFadeUp, useTypewriter } from "../motion";
import { colors, fonts, tracking } from "../theme";

/**
 * Terminal SOLOMON — reproduz fielmente o .sl-demo-terminal da landing.
 *
 * Diferenca chave em relacao a versao antiga (IDE-style):
 *  - background SURFACE (#0c0c12), nao bg2
 *  - border filete dourado-dim (rgba(200,170,110,0.12))
 *  - dots OSX no header (3 circulos coloridos pequenos)
 *  - titulo "solomon · terminal" centralizado em mono dourado-dim
 *  - prompt `$` dourado
 *  - divider hr fino dourado
 *  - cursor dourado piscando
 *  - GLOW LINE dourada na base (assinatura)
 *  - resposta com: verdict pill + answer + quote italic + source (file · p. · §)
 */

export const SolomonTerminal: React.FC<{
  command: string;
  verdict: string;
  answer: string;
  quote: string;
  source: { file: string; page: string; section: string };
  delay?: number;
  width?: number;
  showResponseAfter?: number;
}> = ({
  command,
  verdict,
  answer,
  quote,
  source,
  delay = 0,
  width = 920,
  showResponseAfter = 80,
}) => {
  const enter = useFadeUp(delay, 26);
  const visibleCmd = useTypewriter(command, delay + 14, 1.5);
  const cursorVisible = useBlinkingCursor();
  const responseEnter = useFadeUp(delay + showResponseAfter, 20);

  return (
    <div
      style={{
        ...enter,
        width,
        position: "relative",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        boxShadow: "0 16px 64px rgba(0,0,0,0.55)",
      }}
    >
      <TerminalBar />
      <div style={{ padding: "40px 36px" }}>
        <Prompt cmd={visibleCmd} cursorVisible={cursorVisible} />
        <Divider />
        <div style={responseEnter}>
          <VerdictPill text={verdict} />
          <Answer text={answer} />
          <Quote text={quote} />
          <Source file={source.file} page={source.page} section={source.section} />
        </div>
      </div>
      {/* Glow line dourada — assinatura SOLOMON */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "60%",
          height: 1,
          background: `linear-gradient(to right, transparent, ${colors.gold}, transparent)`,
          boxShadow: "0 0 24px 3px rgba(200, 170, 110, 0.45)",
        }}
      />
    </div>
  );
};

const TerminalBar: React.FC = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "18px 24px",
      background: colors.surface2,
      borderBottom: `1px solid ${colors.border}`,
    }}
  >
    <Dot color="#ff5f57" />
    <Dot color="#febc2e" />
    <Dot color="#28c840" />
    <div
      style={{
        flex: 1,
        textAlign: "center",
        fontFamily: fonts.mono,
        fontSize: 18,
        color: colors.muted,
        letterSpacing: "0.1em",
        marginLeft: -52,
      }}
    >
      solomon · terminal
    </div>
  </div>
);

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <div style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: color }} />
);

const Prompt: React.FC<{ cmd: string; cursorVisible: boolean }> = ({
  cmd,
  cursorVisible,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 16,
      marginBottom: 28,
      fontFamily: fonts.mono,
      fontSize: 24,
      lineHeight: 1.5,
    }}
  >
    <span style={{ color: colors.gold, flexShrink: 0 }}>$</span>
    <span style={{ color: colors.text, flex: 1 }}>
      {cmd}
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 24,
          marginLeft: 4,
          verticalAlign: "middle",
          backgroundColor: cursorVisible ? colors.gold : "transparent",
        }}
      />
    </span>
  </div>
);

const Divider: React.FC = () => (
  <hr
    style={{
      border: "none",
      borderTop: `1px solid ${colors.border}`,
      margin: "28px 0",
    }}
  />
);

const VerdictPill: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      background: "rgba(200, 170, 110, 0.08)",
      border: `1px solid ${colors.goldDim}`,
      padding: "8px 18px",
      marginBottom: 22,
      fontFamily: fonts.sans,
      fontSize: 20,
      fontWeight: 500,
      color: colors.gold,
      letterSpacing: tracking.button,
      textTransform: "uppercase",
    }}
  >
    <span style={{ fontSize: 16, lineHeight: 1 }}>✓</span>
    {text}
  </div>
);

const Answer: React.FC<{ text: string }> = ({ text }) => (
  <p
    style={{
      fontFamily: fonts.sans,
      fontSize: 26,
      color: colors.text,
      lineHeight: 1.7,
      margin: "0 0 22px 0",
      letterSpacing: "-0.005em",
    }}
  >
    {text}
  </p>
);

const Quote: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      borderLeft: `2px solid ${colors.goldDim}`,
      padding: "14px 20px",
      marginBottom: 20,
      fontFamily: fonts.serif,
      fontStyle: "italic",
      fontSize: 24,
      fontWeight: 400,
      color: colors.muted,
      lineHeight: 1.7,
    }}
  >
    &ldquo;{text}&rdquo;
  </div>
);

const Source: React.FC<{ file: string; page: string; section: string }> = ({
  file,
  page,
  section,
}) => (
  <div
    style={{
      fontFamily: fonts.mono,
      fontSize: 17,
      color: colors.goldDim,
      letterSpacing: "0.05em",
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      alignItems: "center",
    }}
  >
    <span>Fonte:</span>
    <strong style={{ color: colors.gold, fontWeight: 600 }}>{file}</strong>
    <span>·</span>
    <span>{page}</span>
    <span>·</span>
    <span>{section}</span>
  </div>
);

/**
 * Mini-terminal compacto — usado nos cards de pilares (Pre-Sinistro/Comparador).
 * Mais simples: so prompt + result + quote opcional.
 */
export const MiniTerminal: React.FC<{
  prompt: string;
  result: string;
  quote?: string;
  delay?: number;
}> = ({ prompt, result, quote, delay = 0 }) => {
  const enter = useFadeUp(delay, 22);
  return (
    <div
      style={{
        ...enter,
        background: "rgba(0, 0, 0, 0.4)",
        border: `1px solid rgba(200, 170, 110, 0.06)`,
        padding: 22,
        fontFamily: fonts.mono,
        fontSize: 18,
        lineHeight: 1.8,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ color: colors.gold, flexShrink: 0 }}>$</span>
        <span style={{ color: colors.muted }}>{prompt}</span>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "flex-start" }}>
        <span style={{ color: colors.gold, flexShrink: 0 }}>→</span>
        <span style={{ color: colors.live, fontWeight: 600 }}>{result}</span>
      </div>
      {quote && (
        <div
          style={{
            color: colors.goldDim,
            fontStyle: "italic",
            fontSize: 16,
            marginTop: 12,
            fontFamily: fonts.serif,
            lineHeight: 1.6,
          }}
        >
          &ldquo;{quote}&rdquo;
        </div>
      )}
    </div>
  );
};
