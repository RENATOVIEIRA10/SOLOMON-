/** GRD-03: fronteira de dominio (vida/pessoas) imposta ANTES da geracao. */

function stripAccentsLower(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const OUT_OF_DOMAIN_PATTERNS: Array<{ domain: string; pattern: RegExp }> = [
  {
    domain: 'auto',
    pattern:
      /\b(seguro\s+(de\s+)?auto(movel)?|seguro\s+automovel|meu\s+carro|do\s+carro|veiculo|guincho|colisao\s+de\s+veiculo)\b/,
  },
  {
    domain: 'residencial',
    pattern:
      /\b(seguro\s+residencial|seguro\s+da\s+casa|seguro\s+do\s+(apto|apartamento|imovel)|incendio\s+residencial)\b/,
  },
  {
    domain: 'viagem',
    pattern:
      /\b(seguro\s+(de\s+)?viagem|assistencia\s+(de\s+)?viagem|seguro\s+viagem)\b/,
  },
]

export interface DomainCheck {
  isOutOfDomain: boolean
  detectedDomain?: string
}

export function detectOutOfDomainQuery(question: string): DomainCheck {
  const q = stripAccentsLower(question)
  for (const { domain, pattern } of OUT_OF_DOMAIN_PATTERNS) {
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
