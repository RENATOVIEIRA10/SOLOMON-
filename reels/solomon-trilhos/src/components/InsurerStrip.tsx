import { interpolate, useCurrentFrame } from "remotion";
import { colors, fonts } from "../theme";

/**
 * Strip horizontal infinita com as 15 seguradoras.
 * Movimento contínuo da direita pra esquerda (estilo trading ticker).
 * Insiders sabem: SOLOMON cobre 15 seguradoras de vida.
 * Cada uma renderizada como SIGLA + cor real da marca.
 */

const INSURERS: { name: string; color: string }[] = [
  { name: "PRUDENTIAL", color: colors.insurer.prudential },
  { name: "MAG", color: colors.insurer.mag },
  { name: "BRADESCO VIDA", color: colors.insurer.bradesco },
  { name: "ICATU", color: colors.insurer.icatu },
  { name: "AZOS", color: colors.insurer.azos },
  { name: "METLIFE", color: colors.insurer.metlife },
  { name: "PORTO SEGURO", color: "#003B71" },
  { name: "SULAMERICA", color: "#FF6900" },
  { name: "TOKIO MARINE", color: "#1F3864" },
  { name: "ZURICH", color: "#0066B3" },
  { name: "MAPFRE", color: "#C8102E" },
  { name: "ALLIANZ", color: "#003781" },
  { name: "CHUBB", color: "#0091DA" },
  { name: "ITAU VIDA", color: "#EC7000" },
  { name: "BB SEGUROS", color: "#FFCC29" },
];

export const InsurerTicker: React.FC<{
  top?: number;
  delay?: number;
  speedPxPerFrame?: number;
}> = ({ top = 1340, delay = 0, speedPxPerFrame = 3.2 }) => {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - delay);
  const offset = -elapsed * speedPxPerFrame;

  const opacity = interpolate(frame, [delay, delay + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // duplicado pra parecer loop infinito
  const items = [...INSURERS, ...INSURERS, ...INSURERS];

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        height: 80,
        overflow: "hidden",
        opacity,
        maskImage:
          "linear-gradient(to right, transparent 0%, #000 12%, #000 88%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0%, #000 12%, #000 88%, transparent 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 28,
          transform: `translateX(${offset}px)`,
          whiteSpace: "nowrap",
        }}
      >
        {items.map((insurer, i) => (
          <InsurerChip key={i} name={insurer.name} color={insurer.color} />
        ))}
      </div>
    </div>
  );
};

const InsurerChip: React.FC<{ name: string; color: string }> = ({
  name,
  color,
}) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 22px",
        background: colors.bgPanel,
        border: `1px solid ${colors.bgElevated}`,
        borderRadius: 12,
        flexShrink: 0,
        height: 60,
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          background: color,
          boxShadow: `0 0 12px ${color}55`,
        }}
      />
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 20,
          fontWeight: 600,
          color: colors.ink,
          letterSpacing: "0.04em",
        }}
      >
        {name}
      </div>
    </div>
  );
};
