import { interpolate, useCurrentFrame } from "remotion";
import { colors, fonts } from "../theme";
import { insurers } from "../script";

/**
 * Ticker SOLOMON — reproduz fielmente .sl-ticker da landing.
 *
 * Diferencas chave da versao antiga (chips coloridos por seguradora):
 *  - Cormorant Garamond 400, NAO mono
 *  - Cor unica muted (#7a7670), gold no hover (estatico aqui)
 *  - Separador "·" (interpunct) dourado-dim entre items
 *  - Label "SEGURADORAS INDEXADAS" a esquerda com fade-out gradient
 *  - Sem chips, sem cores de marca. Editorial puro.
 */
export const InsurerTicker: React.FC<{
  top?: number;
  delay?: number;
  speedPxPerFrame?: number;
}> = ({ top = 1280, delay = 0, speedPxPerFrame = 1.6 }) => {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - delay);
  const offset = -elapsed * speedPxPerFrame;
  const opacity = interpolate(frame, [delay, delay + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const items = [...insurers, ...insurers, ...insurers];

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        height: 92,
        opacity,
        borderTop: `1px solid ${colors.border}`,
        borderBottom: `1px solid ${colors.border}`,
        overflow: "hidden",
        background: colors.black,
      }}
    >
      {/* Label fixa a esquerda */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          padding: "0 28px",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          fontFamily: fonts.sans,
          fontSize: 16,
          color: colors.goldDim,
          letterSpacing: "0.25em",
          textTransform: "uppercase",
          fontWeight: 500,
          background: `linear-gradient(to right, ${colors.black} 70%, transparent)`,
          whiteSpace: "nowrap",
        }}
      >
        Seguradoras indexadas
      </div>

      {/* Track */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 56,
          height: "100%",
          transform: `translateX(${offset}px)`,
          paddingLeft: 360,
          whiteSpace: "nowrap",
        }}
      >
        {items.map((name, i) => (
          <div key={i} style={{ display: "contents" }}>
            <span
              style={{
                fontFamily: fonts.serif,
                fontSize: 36,
                fontWeight: 400,
                color: colors.muted,
                letterSpacing: "0.05em",
                flexShrink: 0,
              }}
            >
              {name}
            </span>
            {i < items.length - 1 && (
              <span
                style={{
                  color: colors.goldDim,
                  fontSize: 16,
                  alignSelf: "center",
                  flexShrink: 0,
                }}
              >
                ·
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
