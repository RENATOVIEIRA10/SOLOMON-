import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { colors } from "../theme";

/**
 * Grid sutil de fundo. Move 1px/frame em diagonal — quase imperceptivel,
 * mas da vida ao frame estatico. Anti-cliche: nao e holograma, nao e neon.
 */
export const Grid: React.FC<{ density?: number; opacity?: number }> = ({
  density = 64,
  opacity = 0.07,
}) => {
  const frame = useCurrentFrame();
  const offset = (frame * 0.3) % density;
  const fade = interpolate(frame, [0, 20], [0, opacity], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        backgroundImage: `
          linear-gradient(to right, ${colors.inkDim} 1px, transparent 1px),
          linear-gradient(to bottom, ${colors.inkDim} 1px, transparent 1px)
        `,
        backgroundSize: `${density}px ${density}px`,
        backgroundPosition: `${offset}px ${offset}px`,
        opacity: fade,
      }}
    />
  );
};

/**
 * Vinheta radial sutil. Empurra o olho pro centro sem ser obvio.
 */
export const Vignette: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)`,
        pointerEvents: "none",
      }}
    />
  );
};
