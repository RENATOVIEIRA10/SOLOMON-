export const BRAND = {
  colors: {
    black: '#0A0A0A',
    gold: '#B8933A',
    cream: '#F5EFE0',
    graphite: '#1A1A1A',
    goldLight: '#D4AF37',
    goldDark: '#8B6914',
  },
  fonts: {
    headline: 'Cormorant Garamond',
    body: 'Inter',
    mono: 'JetBrains Mono',
  },
  tagline: 'Certeza absoluta. Em segundos.',
  positioning: 'Seu consultor privado de seguros de vida',
} as const

/** Keys MUST match the DB CHECK: brokers_plan_check (lowercase). */
export type BrokerPlan = 'free' | 'corretor' | 'consultor' | 'corretora'

export const PLANS = {
  free: { name: 'Gratuito', queriesPerDay: 5, price: 0 },
  corretor: { name: 'Corretor', queriesPerDay: 50, price: 5900 },
  consultor: { name: 'Consultor', queriesPerDay: -1, price: 14900 },
  corretora: { name: 'Corretora', queriesPerDay: -1, price: 34900, maxUsers: 5 },
} as const satisfies Record<BrokerPlan, { name: string; queriesPerDay: number; price: number; maxUsers?: number }>

export const RAG = {
  chunkSize: 500,
  chunkOverlap: 50,
  topK: 15,
  /** Fetch more from pgvector, then rerank/diversify down to topK.
   *  Usado apenas quando ha seguradora(s) detectada(s) — busca por insurer
   *  nao contamina contexto, entao vale puxar mais candidatos. */
  fetchK: 50,
  /** Busca global (nenhuma seguradora mencionada): fetchK estreito para
   *  evitar contaminacao cross-insurer no contexto do LLM. */
  globalTopK: 15,
  similarityThreshold: 0.35,
  /** Max chunks per insurer when no specific insurer is mentioned */
  maxPerInsurer: 5,
  model: 'gemini-2.0-flash',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
} as const
