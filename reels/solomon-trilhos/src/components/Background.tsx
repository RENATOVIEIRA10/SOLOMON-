import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { colors } from "../theme";

/**
 * Fundo SOLOMON.
 *
 * NAO usar grid IDE-style. A landing nao tem grid — tem espaco preto puro
 * com canvas WebGL de wireframe sphere/horizon (impossivel reproduzir em
 * Remotion sem GPU pesado). Substituimos por:
 *  - preto puro #06060a
 *  - vinheta sutil dourada (gradient radial muito fraco)
 *  - particulas douradas raras flutuando (sem virar starfield clichê)
 */
export const Background: React.FC<{ withParticles?: boolean }> = ({
  withParticles = true,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.black }}>
      <RadialGoldGlow />
      {withParticles && <GoldParticles />}
    </AbsoluteFill>
  );
};

const RadialGoldGlow: React.FC = () => {
  const frame = useCurrentFrame();
  // Pulse extremamente sutil — 0.05 a 0.10 no centro
  const intensity = interpolate(
    frame % 120,
    [0, 60, 120],
    [0.05, 0.08, 0.05],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 70% 60% at 50% 55%, rgba(200,170,110,${intensity}) 0%, transparent 70%)`,
        pointerEvents: "none",
      }}
    />
  );
};

/**
 * Particulas douradas — 24 pontos em posicoes deterministicas (seed),
 * flutuando lentamente. Diferente de starfield generico — espalhadas,
 * pequenas, com opacidade variavel.
 */
const PARTICLE_SEED: { x: number; y: number; size: number; phase: number }[] =
  Array.from({ length: 24 }, (_, i) => {
    // PRNG simples baseada em seno do indice
    const r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    const r2 = Math.abs(Math.sin(i * 78.233) * 12345.6789) % 1;
    const r3 = Math.abs(Math.sin(i * 39.346) * 9876.5432) % 1;
    return {
      x: r1 * 1080,
      y: r2 * 1920,
      size: 1 + r3 * 2,
      phase: i * 0.7,
    };
  });

const GoldParticles: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {PARTICLE_SEED.map((p, i) => {
        const drift = Math.sin((frame + p.phase * 30) / 60) * 8;
        const opacity =
          0.15 + (Math.sin((frame + p.phase * 30) / 45) + 1) * 0.18;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y + drift,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              backgroundColor: colors.gold,
              opacity,
              filter: "blur(0.3px)",
              boxShadow: `0 0 ${p.size * 3}px rgba(200,170,110,${opacity * 0.5})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * Linha de glow dourada — equivalente ao .sl-t-glow da landing.
 * Posicionar abaixo de elementos importantes (terminal, hero).
 */
export const GoldGlowLine: React.FC<{
  width?: string | number;
  top?: number | string;
  left?: string;
  intensity?: number;
}> = ({ width = "60%", top = "100%", left = "50%", intensity = 0.3 }) => {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        transform: "translateX(-50%)",
        width,
        height: 1,
        background: `linear-gradient(to right, transparent, ${colors.gold}, transparent)`,
        boxShadow: `0 0 20px 2px rgba(200, 170, 110, ${intensity})`,
        pointerEvents: "none",
      }}
    />
  );
};
