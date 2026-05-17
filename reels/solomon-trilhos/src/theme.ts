/**
 * Design tokens para o reel SOLOMON.
 *
 * Anti-cliche: zero gradient holografico, zero neon, zero "AI blue".
 * Paleta inspirada em IDE escuro (Linear/Stripe/Vercel) com 1 verde
 * proprio que NAO copia o verde do WhatsApp puro.
 */

export const colors = {
  // Fundo: nao e preto puro. Tem um pouco de azul-verde frio.
  bg: "#0B0F14",
  bgElevated: "#10161D",
  bgPanel: "#161D26",

  // Texto
  ink: "#F5F7FA",
  inkMuted: "#8A95A5",
  inkDim: "#4A5566",

  // Accent primario — verde-SOLOMON. Mais sofisticado que WA puro.
  // (#25D366 e o WhatsApp; aqui usamos um ciano-verde mais escuro)
  primary: "#00C896",
  primaryDim: "#00A37A",
  primaryGlow: "rgba(0,200,150,0.18)",

  // Accent secundario — alerta/atencao (NAO vermelho cliche)
  warn: "#F2B441",
  warnDim: "#C7913A",

  // Vermelho calmo — pra NAO_COBERTO. Nao saturado.
  danger: "#E5484D",

  // Cores das seguradoras (no Trilho 2). Tons reais, NAO neons.
  insurer: {
    bradesco: "#CC092F",
    mag: "#00457C",
    prudential: "#1A3A6E",
    azos: "#5E3FBE",
    metlife: "#0061A0",
    icatu: "#E4002B",
  },
} as const;

export const fonts = {
  // Mono usada para tudo "codigo/sistema". Cinematica.
  mono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
  // Sans para texto humano (WhatsApp, narrativa).
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  // Display: usado nos titulos de trilho e final.
  display:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

export const sizes = {
  // Vertical 9:16
  width: 1080,
  height: 1920,
  fps: 30,
  totalDurationFrames: 1050, // 35 segundos
} as const;

/**
 * Cubic-bezier estilo Apple/Stripe (smooth, com um tique de overshoot
 * controlado no out). NUNCA usar easeInOut padrao — fica generico.
 */
export const easings = {
  // Out: chega rapido, desacelera no fim. Para entradas.
  smooth: [0.32, 0.72, 0, 1] as const,
  // In: comeca lento, acelera. Para saidas.
  smoothIn: [0.7, 0, 0.84, 0] as const,
  // Spring rapido pra microinteracoes
  snap: [0.34, 1.56, 0.64, 1] as const,
} as const;

/**
 * Marcadores de tempo (em frames @ 30fps) por cena.
 * Total = 1050 frames = 35s.
 */
export const sceneTimings = {
  hook: { start: 0, duration: 150 }, // 0-5s
  trilho1: { start: 150, duration: 210 }, // 5-12s
  trilho2: { start: 360, duration: 210 }, // 12-19s
  trilho3: { start: 570, duration: 210 }, // 19-26s
  eval: { start: 780, duration: 180 }, // 26-32s
  outro: { start: 960, duration: 90 }, // 32-35s
} as const;
