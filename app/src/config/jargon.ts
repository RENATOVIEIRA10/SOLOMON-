/**
 * Jargão de mercado BR — Seguros de Vida
 *
 * Corretor digita "DIT" → PDF diz "Incapacidade Temporária".
 * Corretor digita "diária hospitalar" → PDF diz "Renda Hospitalar".
 * Embedding semântico não faz essa ponte sozinho, então expandimos a
 * query ANTES do embedding com os termos técnicos reais que aparecem
 * nas condições gerais das seguradoras.
 *
 * Termos validados contra chunks reais no banco (Prudential, Bradesco,
 * SulAmérica, MetLife). Só colocamos aqui o que foi observado aparecendo
 * nos PDFs com esses rótulos técnicos.
 */

export interface JargonEntry {
  /** Jargão / sigla que o corretor tende a digitar */
  term: string
  /** Termos técnicos / sinônimos que aparecem nos PDFs */
  expansions: string[]
}

export const JARGON_DICT: JargonEntry[] = [
  // Coberturas temporárias
  {
    term: 'DIT',
    expansions: ['Diária por Incapacidade Temporária', 'Incapacidade Temporária', 'Diária de Incapacidade'],
  },
  {
    term: 'DIT-A',
    expansions: ['Diária de Incapacidade Temporária por Acidente', 'Incapacidade Temporária Acidente'],
  },
  {
    term: 'DIT-D',
    expansions: ['Diária de Incapacidade Temporária por Doença', 'Incapacidade Temporária Doença'],
  },
  {
    term: 'IT',
    expansions: ['Incapacidade Temporária'],
  },

  // Cobertura hospitalar
  {
    term: 'DIH',
    expansions: ['Diária Hospitalar', 'Renda Hospitalar', 'Diária por Internação', 'Diária de Internação', 'Renda por Internação Hospitalar'],
  },
  {
    term: 'diária hospitalar',
    expansions: ['Renda Hospitalar', 'Diária por Internação', 'Renda por Internação Hospitalar'],
  },
  {
    term: 'diaria hospitalar',
    expansions: ['Renda Hospitalar', 'Diária por Internação', 'Renda por Internação Hospitalar'],
  },

  // Invalidez
  {
    term: 'IPA',
    expansions: ['Invalidez Permanente por Acidente', 'Invalidez Permanente Total ou Parcial por Acidente'],
  },
  {
    term: 'IPTA',
    expansions: ['Invalidez Permanente Total por Acidente'],
  },
  {
    term: 'IPPA',
    expansions: ['Invalidez Permanente Parcial por Acidente'],
  },
  {
    term: 'IFPD',
    expansions: ['Invalidez Funcional Permanente por Doença', 'Invalidez Funcional'],
  },
  {
    term: 'IPD',
    expansions: ['Invalidez Permanente por Doença'],
  },
  {
    term: 'MAJORADA',
    expansions: ['pagamento de 100% do capital segurado mesmo em invalidez parcial', 'percentual integral de indenização'],
  },

  // Morte
  {
    term: 'MA',
    expansions: ['Morte Acidental', 'Morte por Acidente'],
  },
  {
    term: 'MN',
    expansions: ['Morte Natural'],
  },
  {
    term: 'MRR',
    expansions: ['Morte por Qualquer Causa'],
  },

  // Doenças graves
  {
    term: 'DG',
    expansions: ['Doenças Graves', 'Doenças Críticas'],
  },

  // Produtos
  {
    term: 'AP',
    expansions: ['Seguro de Acidentes Pessoais', 'Acidentes Pessoais'],
  },
  {
    term: 'VGBL',
    expansions: ['Vida Gerador de Benefício Livre'],
  },
  {
    term: 'PGBL',
    expansions: ['Plano Gerador de Benefício Livre'],
  },
  {
    term: 'prestamista',
    expansions: ['Seguro Prestamista', 'cobertura de prestação'],
  },
  {
    term: 'vida em grupo',
    expansions: ['Seguro de Vida em Grupo', 'Seguro Coletivo'],
  },

  // Conceitos financeiros / contratuais
  {
    term: 'IS',
    expansions: ['Importância Segurada', 'Capital Segurado'],
  },
  {
    term: 'CS',
    expansions: ['Capital Segurado', 'Importância Segurada'],
  },
  {
    term: 'LMI',
    expansions: ['Limite Máximo de Indenização'],
  },
  {
    term: 'CG',
    expansions: ['Condições Gerais'],
  },
  {
    term: 'franquia',
    expansions: ['Franquia', 'Período de Franquia', 'Participação do Segurado'],
  },
  {
    term: 'carência',
    expansions: ['Período de Carência', 'Prazo de Carência'],
  },
  {
    term: 'carencia',
    expansions: ['Período de Carência', 'Prazo de Carência'],
  },
  {
    term: 'contestabilidade',
    expansions: ['Período de Contestabilidade', 'prazo para contestar o contrato'],
  },
  {
    term: 'resgate',
    expansions: ['Resgate de Valores', 'Retirada', 'Saque'],
  },
  {
    term: 'saldado',
    expansions: ['Capital Remido', 'Benefício Saldado', 'Valor Saldado'],
  },
  {
    term: 'capital remido',
    expansions: ['Capital Remido', 'Saldado'],
  },
  {
    term: 'endosso',
    expansions: ['Endosso', 'Alteração Contratual'],
  },
  {
    term: 'portabilidade',
    expansions: ['Portabilidade de Carência', 'Migração de Plano'],
  },
  {
    term: 'estipulante',
    expansions: ['Estipulante', 'Beneficiário Estipulante'],
  },
  {
    term: 'cosseguro',
    expansions: ['Cosseguro'],
  },
  {
    term: 'resseguro',
    expansions: ['Resseguro'],
  },

  // Regulatório / comercial
  {
    term: 'SUSEP',
    expansions: ['processo SUSEP', 'Superintendência de Seguros Privados'],
  },
  {
    term: 'OPIN',
    expansions: ['Open Insurance', 'Open Insurance Brasil'],
  },
]

/**
 * Expand a query with jargon technical terms so the embedding
 * captures both corretor's shorthand and the exact phrasing used
 * in insurer PDFs.
 *
 * Preserves the original query and appends relevant technical terms.
 * Deterministic, cheap, no LLM call.
 */
export function expandQueryWithJargon(question: string): string {
  const normalized = question.toLowerCase()
  const added: string[] = []
  const seen = new Set<string>()

  for (const entry of JARGON_DICT) {
    const termLower = entry.term.toLowerCase()

    // Match as whole word for short acronyms (len <= 4) to avoid false positives
    // ("AP" shouldn't match inside "apontar"); substring match for longer terms.
    const matched =
      termLower.length <= 4
        ? new RegExp(`\\b${escapeRegExp(termLower)}\\b`, 'i').test(normalized)
        : normalized.includes(termLower)

    if (!matched) continue

    for (const expansion of entry.expansions) {
      const key = expansion.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      added.push(expansion)
    }
  }

  if (added.length === 0) return question
  return `${question} [contexto técnico: ${added.join('; ')}]`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
