import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { easings } from "./theme";

/**
 * Motion alinhado ao .sl-fadeUp da landing real:
 *   from { opacity: 0; transform: translateY(24px); }
 *   to   { opacity: 1; transform: translateY(0); }
 *   cubic-bezier(0.16, 1, 0.3, 1), ~0.8s
 *
 * E ao .sl-wordIn:
 *   from { opacity: 0; transform: translateY(60px); }
 *   to   { opacity: 1; transform: translateY(0); }
 *   0.7s + stagger de 150ms entre palavras.
 */

/** Padrao entrada de bloco — equivale ao .sl-reveal-up.sl-visible da landing */
export const useFadeUp = (delay: number = 0, duration: number = 24) => {
  const frame = useCurrentFrame();
  const t = (frame - delay) / duration;

  const opacity = interpolate(t, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => bezier(x, easings.fadeUp),
  });

  const translateY = interpolate(t, [0, 1], [24, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => bezier(x, easings.fadeUp),
  });

  return {
    opacity,
    transform: `translateY(${translateY}px)`,
  };
};

/** Word-in usado no hero — slide vertical maior (60px) */
export const useWordIn = (delay: number = 0, duration: number = 21) => {
  const frame = useCurrentFrame();
  const t = (frame - delay) / duration;

  const opacity = interpolate(t, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => bezier(x, easings.fadeUp),
  });

  const translateY = interpolate(t, [0, 1], [60, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => bezier(x, easings.fadeUp),
  });

  return {
    opacity,
    transform: `translateY(${translateY}px)`,
  };
};

/** Spring sutil para microelementos (badges, status dots) */
export const useSpringIn = (delay: number = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, mass: 0.7, stiffness: 160 },
    durationInFrames: 18,
  });
};

/** Typewriter para terminal */
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

/** Cursor piscando — 1Hz (estilo .sl-t-cursor da landing) */
export const useBlinkingCursor = () => {
  const frame = useCurrentFrame();
  return frame % 30 < 15;
};

/** Count-up para stats — igual stat counters da landing */
export const useCountUp = (
  target: number,
  delay: number = 0,
  duration: number = 36,
) => {
  const frame = useCurrentFrame();
  const t = Math.max(0, frame - delay) / duration;
  const eased = 1 - Math.pow(1 - Math.min(t, 1), 3);
  return Math.round(eased * target);
};

/** Stagger fixo de 4 frames entre elementos irmaos */
export const stagger = (index: number, step: number = 4) => index * step;

// ─────────────────────────────────────────────────────────────
// cubic-bezier puro em JS (Newton-Raphson 6 iter)
// ─────────────────────────────────────────────────────────────

function bezier(
  x: number,
  [p1x, p1y, p2x, p2y]: readonly [number, number, number, number],
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
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
