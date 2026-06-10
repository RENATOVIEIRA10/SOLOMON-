/** GRD-03: fronteira de dominio (vida/pessoas) imposta ANTES da geracao. */

// WR-05: escapes unicode explicitos (\u0300-\u036f) em vez de combining chars
// literais no fonte — sobrevive a re-encoding/normalizacao (este repo ja teve
// mojibake em pre-sinistro.ts). Mesmo padrao de answer.ts e pre-sinistro.ts.
function stripAccentsLower(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * CR-01: vocabulario de seguro de vida/pessoas. Quando presente, mencoes a
 * veiculo/carro/guincho/colisao sao tratadas como CAUSA do sinistro (morte ou
 * invalidez em acidente de transporte — cenario canonico de AP/vida), e NAO
 * como pergunta sobre seguro auto. Nesse caso so bloqueia se houver frase
 * EXPLICITA de produto de outro ramo (ver EXPLICIT_PRODUCT_PATTERNS).
 */
const LIFE_CONTEXT_RE =
  /\b(seguro\s+de\s+vida|vida\s+inteira|apolices?|ap\b|acidentes?\s+pessoais?|invalidez|ipa\b|ipta\b|ifpd\b|dita?\b|doencas?\s+graves?|funeral|morte|morrer|faleceu|falecimento|atropelad[oa]|capital\s+segurado|segurad[oa]s?\b|pensao|carencia|indenizacao|indeniza|beneficiari[oa]s?)\b/

/**
 * Frases EXPLICITAS de produto de outro ramo: a pergunta e sobre o PRODUTO
 * auto/residencial/viagem. Bloqueiam sempre, mesmo com vocabulario de vida na
 * pergunta (ex.: G-06 "franquia do meu seguro de carro").
 */
const EXPLICIT_PRODUCT_PATTERNS: Array<{ domain: string; pattern: RegExp }> = [
  {
    domain: 'auto',
    pattern:
      /\b(seguro\s+(de\s+)?auto(movel)?|seguro\s+(de\s+|do\s+)?(meu\s+|minha\s+)?(carro|veiculo|moto)|seguro\s+veicular)\b/,
  },
  {
    domain: 'residencial',
    pattern:
      /\b(seguro\s+residencial|seguro\s+da\s+casa|seguro\s+do\s+(apto|apartamento|imovel)|incendio\s+residencial)\b/,
  },
  {
    domain: 'viagem',
    pattern: /\b(seguro\s+(de\s+)?viagem|assistencia\s+(de\s+)?viagem)\b/,
  },
]

/**
 * Contexto de auto SEM frase explicita de produto: so bloqueia quando NAO ha
 * vocabulario de vida/pessoas na pergunta (CR-01). "Veiculo" como causa de
 * morte/invalidez e dominio AP/vida — nunca out-of-domain.
 */
const CONTEXTUAL_PATTERNS: Array<{ domain: string; pattern: RegExp }> = [
  {
    domain: 'auto',
    pattern:
      /\b(franquia\s+do\s+(carro|veiculo)|guincho|colisao\s+de\s+veiculos?|meu\s+carro|do\s+carro|veiculo)\b/,
  },
]

export interface DomainCheck {
  isOutOfDomain: boolean
  detectedDomain?: string
}

export function detectOutOfDomainQuery(question: string): DomainCheck {
  const q = stripAccentsLower(question)
  // 1. Produto explicito de outro ramo: bloqueia sempre.
  for (const { domain, pattern } of EXPLICIT_PRODUCT_PATTERNS) {
    if (pattern.test(q)) return { isOutOfDomain: true, detectedDomain: domain }
  }
  // 2. Vocabulario de vida/pessoas presente: pergunta e in-domain
  //    (veiculo/guincho/colisao = causa do sinistro, nao produto auto).
  if (LIFE_CONTEXT_RE.test(q)) return { isOutOfDomain: false }
  // 3. Contexto de auto sem termos de vida: bloqueia.
  for (const { domain, pattern } of CONTEXTUAL_PATTERNS) {
    if (pattern.test(q)) return { isOutOfDomain: true, detectedDomain: domain }
  }
  return { isOutOfDomain: false }
}

const DOMAIN_LABELS: Record<string, string> = {
  auto: 'seguro de automovel',
  residencial: 'seguro residencial',
  viagem: 'seguro viagem',
}

export function refusalMessageForDomain(detectedDomain?: string): string {
  const label = detectedDomain
    ? (DOMAIN_LABELS[detectedDomain] ?? detectedDomain)
    : 'esse ramo'
  return (
    `Eu cubro apenas seguros de vida e de pessoas (vida, invalidez, doencas graves, DIT/DITA, pensao, funeral). ` +
    `Sua pergunta parece ser sobre ${label}, que esta fora do meu dominio. ` +
    `Nao tenho fontes indexadas para responder isso com seguranca.`
  )
}
