import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { easings } from "./theme";

/**
 * Sistema de motion premium.
 *
 * Decisoes:
 * - SEM ease "linear" — quebra a sensacao premium.
 * - SEM bounce exagerado — overshoot leve so em CTA/microintegracoes.
 * - SEM fade puro — sempre fade + slide pequeno + scale 0.98→1.
 * - Stagger fixo de 4 frames entre elementos irmaos.
 */

/** Fade + slide-up + scale leve. Padrao para ENTRADAS de cards/blocos. */
export const useEnter = (delay: number = 0, duration: number = 24) => {
  const frame = useCurrentFrame();
  const t = (frame - delay) / duration;

  const opacity = interpolate(t, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => bezier(x, easings.smooth),
  });

  const translateY = interpolate(t, [0, 1], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => bezier(x, easings.smooth),
  });

  const scale = interpolate(t, [0, 1], [0.98, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => bezier(x, easings.smooth),
  });

  return {
    opacity,
    transform: `translateY(${translateY}px) scale(${scale})`,
  };
};

/**
 * Spring snap — para entrar com leve overshoot. Usar em microelementos
 * (cursor piscando, check verde, contador).
 */
export const useSnap = (delay: number = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const value = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, mass: 0.6, stiffness: 180 },
    durationInFrames: 18,
  });
  return value;
};

/**
 * Typewriter: revela texto progressivamente. Usar para terminal-style.
 * Retorna numero de caracteres visiveis.
 */
export const useTypewriter = (
  text: string,
  delay: number = 0,
  charsPerFrame: number = 1.4,
) => {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, frame - delay);
  const visible = Math.min(text.length, Math.floor(elapsed * charsPerFrame));
  return text.slice(0, visible);
};

/**
 * Cursor piscando estilo terminal. 1 ciclo a cada 30 frames (~1s).
 */
export const useBlinkingCursor = () => {
  const frame = useCurrentFrame();
  return frame % 30 < 15;
};

/**
 * Cubic-bezier puro em JS — precisao boa o bastante pra easing.
 * Implementacao iterativa (Newton-Raphson com 6 iteracoes).
 */
function bezier(
  x: number,
  [p1x, p1y, p2x, p2y]: readonly [number, number, number, number],
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Resolve t para um dado x usando Newton-Raphson.
  let t = x;
  for (let i = 0; i < 6; i++) {
    const xt = bezierAxis(t, p1x, p2x);
    const dxt = bezierAxisDerivative(t, p1x, p2x);
    if (Math.abs(dxt) < 1e-6) break;
    t = t - (xt - x) / dxt;
  }

  return bezierAxis(t, p1y, p2y);
}

function bezierAxis(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function bezierAxisDerivative(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** Helper: stagger fixo de 4 frames entre elementos irmaos. */
export const stagger = (index: number, step: number = 4) => index * step;
