/**
 * Design tokens — ADERENTE ao SOLOMON real.
 *
 * Fontes de verdade:
 *   app/src/app/globals.css  (tokens :root + .sl-* design)
 *   app/src/app/page.tsx     (landing oficial usando esses tokens)
 *
 * SOLOMON e LUXURY EDITORIAL: preto puro + ouro + Cormorant Garamond.
 * NUNCA confundir com IDE-dark generico (Linear/Stripe/Vercel).
 */

export const colors = {
  // Base preta — usa o mesmo do .sl-root (NAO o --solomon-black=#0A0A0A do app shell)
  black: "#06060a",
  surface: "#0c0c12",
  surface2: "#111118",

  // Ouro — a cor da marca
  gold: "#C8AA6E",
  goldBright: "#E2C97E",
  goldDim: "#7a6540",

  // Borda dourada quase invisivel — assinatura SOLOMON
  border: "rgba(200, 170, 110, 0.12)",
  borderHover: "rgba(200, 170, 110, 0.32)",
  borderGlow: "rgba(200, 170, 110, 0.4)",

  // Texto cream (NAO branco puro)
  text: "#e8e4dc",
  muted: "#7a7670",
  mutedDeep: "#4a4640",

  // Status (do .sl-pillar-status / .sl-badge-dot)
  live: "#4ade80",
  warn: "#facc15",
  danger: "#f87171",
} as const;

export const fonts = {
  // Cormorant Garamond — serif editorial. Display/titles/numbers.
  serif:
    "'Cormorant Garamond', 'Cormorant', Georgia, 'Times New Roman', serif",
  // Sans para texto corrido (subtitle, body).
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  // Mono para terminal/comandos.
  mono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
} as const;

export const sizes = {
  // Vertical 9:16
  width: 1080,
  height: 1920,
  fps: 30,
  totalDurationFrames: 1050, // 35 segundos
} as const;

/**
 * Easings da landing real:
 *   sl-fadeUp        usa cubic-bezier(0.16, 1, 0.3, 1)
 *   sl-wordIn        usa cubic-bezier(0.16, 1, 0.3, 1)
 *   sl-pillar-card   transition 0.3s ease
 */
export const easings = {
  // out-expo-ish — chega rapido, desacelera no final
  fadeUp: [0.16, 1, 0.3, 1] as const,
  // Para saidas
  fadeOut: [0.84, 0, 0.16, 1] as const,
} as const;

/**
 * Letterspacing — assinaturas da landing:
 *   sl-nav-logo:         0.18em
 *   sl-hero-badge:       0.25em
 *   sl-section-label:    0.30em
 *   sl-cta-eyebrow:      0.30em
 *   sl-btn-primary:      0.15em
 *   sl-section-title:    -0.01em (tight em serif)
 *   sl-hero-title:       -0.01em (Cormorant 300)
 */
export const tracking = {
  wordmark: "0.18em",
  badge: "0.25em",
  eyebrow: "0.30em",
  button: "0.15em",
  body: "0",
  tightSerif: "-0.01em",
} as const;

/**
 * Marcadores de tempo (em frames @ 30fps) por cena.
 * Total = 1050 frames = 35s.
 *
 * Estrutura adere a landing:
 *   1. HERO         (Certeza absoluta. Em segundos.)
 *   2. AO VIVO      (terminal com pergunta + resposta com fonte)
 *   3. PRE-SINISTRO (badges + risk flags)
 *   4. COMPARADOR   (tabela lado a lado)
 *   5. STATS        (14+ / 16.940 / 3s / 24/7)
 *   6. CTA          (Pronto para provar?)
 */
export const sceneTimings = {
  hero: { start: 0, duration: 180 }, // 0-6s
  aoVivo: { start: 180, duration: 210 }, // 6-13s
  preSinistro: { start: 390, duration: 180 }, // 13-19s
  comparador: { start: 570, duration: 180 }, // 19-25s
  stats: { start: 750, duration: 180 }, // 25-31s
  cta: { start: 930, duration: 120 }, // 31-35s
} as const;
