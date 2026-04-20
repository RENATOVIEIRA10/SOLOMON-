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

export const PLANS = {
  FREE: { name: 'Gratuito', queriesPerDay: 5, price: 0 },
  CORRETOR: { name: 'Corretor', queriesPerDay: 50, price: 5900 },
  CONSULTOR: { name: 'Consultor', queriesPerDay: -1, price: 14900 },
  CORRETORA: { name: 'Corretora', queriesPerDay: -1, price: 34900, maxUsers: 5 },
} as const

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
