import type { CSSProperties } from "react";
import { useEnter } from "../motion";
import { colors, fonts } from "../theme";

/**
 * Bubble inspirada em WhatsApp mas com paleta SOLOMON.
 * - "in"  = mensagem do cliente (esquerda, cinza claro)
 * - "out" = resposta do SOLOMON (direita, verde-SOLOMON)
 *
 * Anti-cliche: nao usa o verde do WhatsApp puro, nao usa avatar de robo,
 * nao tem "..." de bot pensando.
 */
export const WhatsAppBubble: React.FC<{
  variant: "in" | "out";
  delay?: number;
  children: React.ReactNode;
  meta?: string; // hora ou label tipo "Pedro"
  maxWidth?: number;
  alignOverride?: "left" | "right";
}> = ({ variant, delay = 0, children, meta, maxWidth = 720, alignOverride }) => {
  const enter = useEnter(delay, 22);
  const isOut = variant === "out";
  const align: "left" | "right" = alignOverride ?? (isOut ? "right" : "left");

  const bubbleStyle: CSSProperties = {
    ...enter,
    maxWidth,
    background: isOut ? colors.primary : colors.bgPanel,
    color: isOut ? "#03110D" : colors.ink,
    padding: "20px 26px",
    borderRadius: 20,
    borderTopRightRadius: isOut ? 4 : 20,
    borderTopLeftRadius: isOut ? 20 : 4,
    fontFamily: fonts.sans,
    fontSize: 32,
    lineHeight: 1.35,
    letterSpacing: "-0.015em",
    boxShadow: isOut
      ? `0 8px 32px ${colors.primaryGlow}`
      : "0 6px 24px rgba(0,0,0,0.3)",
    border: isOut
      ? "1px solid rgba(0,200,150,0.4)"
      : `1px solid ${colors.bgElevated}`,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "flex-start",
        gap: 6,
        width: "100%",
      }}
    >
      {meta && (
        <div
          style={{
            ...enter,
            fontFamily: fonts.mono,
            fontSize: 18,
            color: colors.inkMuted,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            paddingLeft: align === "left" ? 6 : 0,
            paddingRight: align === "right" ? 6 : 0,
          }}
        >
          {meta}
        </div>
      )}
      <div style={bubbleStyle}>{children}</div>
    </div>
  );
};

/**
 * Container vertical das bubbles. Padding generoso, gap entre mensagens.
 */
export const ChatStack: React.FC<{
  children: React.ReactNode;
  top?: number;
}> = ({ children, top = 520 }) => {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 80,
        right: 80,
        display: "flex",
        flexDirection: "column",
        gap: 32,
      }}
    >
      {children}
    </div>
  );
};
