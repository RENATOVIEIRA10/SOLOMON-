/** GRD-04 (canal oraculo): detector de pedido de veredicto sobre sinistro concreto. */

// WR-05: escapes unicode explicitos (\u0300-\u036f) em vez de combining chars
// literais no fonte — sobrevive a re-encoding/normalizacao (este repo ja teve
// mojibake em pre-sinistro.ts). Mesmo padrao de domain-guard.ts.
function stripAccentsLower(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Grupo 1 — EVENTO CONCRETO ocorrido.
 *
 * Cobre:
 *   a) sujeito explícito + verbo de evento  (o segurado faleceu, a cliente foi internada)
 *   b) locuções sem sujeito explícito        (faleceu por, sofreu um acidente, o sinistro ocorreu)
 *   c) adoecimento/fratura sem sujeito       (fraturou, foi internado, teve um infarto)
 */
const CLAIM_EVENT_RE =
  /(?:(?:segurad[oa]s?|clientes?|beneficiari[oa]s?|ele|ela)\s+(?:faleceu|morreu|veio\s+a\s+obito|sofreu(?:\s+um?)?\s+acidente|se\s+acidentou|foi\s+internad|foi\s+diagnosticad|teve\s+um?\s+(?:infarto|avc|acidente)|fraturou|veio\s+a\s+falecer))|(?:(?:faleceu|morreu|veio\s+a\s+obito)\s+(?:por|de|durante)\b)|(?:sofreu\s+um?\s+acidente\b)|(?:o\s+sinistro\s+(?:ocorreu|aconteceu)\b)|(?:\bfraturou\b)|(?:foi\s+internad[oa]\b)|(?:foi\s+diagnosticad[oa]\b)|(?:teve\s+um?\s+(?:infarto|avc)\b)|(?:\bparada\s+cardiaca\b)|(?:faleceu\s+ontem\b)|(?:faleceu\b(?!\s+na\s+proposta))/

/**
 * Grupo 2 — PEDIDO DE VEREDICTO ou AÇÃO DE SINISTRO.
 *
 * Cobre: "e coberto", "esta coberto", "tem cobertura", "presumir cobertura",
 *        "pode presumir", "seguradora paga/indeniza/nega/recusa",
 *        "acionar o seguro", "abrir o sinistro", "beneficiario recebe/tem direito",
 *        "veredito".
 */
const VERDICT_RE =
  /(?:\b(?:e|esta|seria|fica)\s+cobert)|(?:\btem\s+cobertura\b)|(?:presumir(?:\s+que\s+(?:e\s+|esta\s+)?|\s+a\s+)?cobert)|(?:\bpode\s+presumir\b)|(?:\bseguradora\s+(?:paga|indeniza|nega|recusa)\b)|(?:\bacionar\s+o\s+seguro\b)|(?:\babrir\s+o\s+sinistro\b)|(?:\bbeneficiari[oa]s?\s+(?:recebe|tem\s+direito)\b)|(?:\bveredito\b)|(?:(?:familia|beneficiari[oa]s?)\s+recebe\b)/

/**
 * detectClaimVerdictIntent — true SOMENTE quando AMBOS os grupos casam.
 *
 * Pergunta com veredicto mas sem evento concreto (ex.: "seguro de vida cobre
 * morte acidental?") e CONCEITUAL -> retorna false.
 * Pergunta com evento mas sem pedido de veredicto (ex.: "o segurado faleceu,
 * quais documentos preciso?") e OPERACIONAL -> retorna false.
 */
export function detectClaimVerdictIntent(question: string): boolean {
  const q = stripAccentsLower(question)
  return CLAIM_EVENT_RE.test(q) && VERDICT_RE.test(q)
}

/**
 * claimGuidanceMessage — mensagem orientativa, inconclusiva por construcao.
 * Nunca presume cobertura; direciona ao trilho pre-sinistro do SOLOMON.
 */
export function claimGuidanceMessage(): string {
  return (
    'Para emitir um veredito sobre cobertura de um sinistro concreto, e necessario analisar ' +
    'as condicoes gerais da apolice especifica — o SOLOMON nao pode concluir COBERTO ou ' +
    'NAO_COBERTO sem a clausula aplicavel em maos. Nunca presuma cobertura sem clausula aplicavel. ' +
    'Utilize o trilho Pre-Sinistro do SOLOMON: informe o numero da apolice (ou nome do produto) ' +
    'e descreva o evento em detalhes para obter uma analise fundamentada nas condicoes gerais ' +
    'da seguradora. Sem esses dados, qualquer conclusao sobre cobertura seria uma presuncao ' +
    'sem base contratual.'
  )
}
