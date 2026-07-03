/**
 * Normaliza telefone brasileiro para E.164 (+55DDDNÚMERO).
 * Aceita máscaras, espaços, prefixo 55 com/sem +. Nacional = 10 (fixo) ou
 * 11 (celular) dígitos. Retorna null quando não dá para normalizar com
 * segurança — o chamador decide o erro.
 */
export function normalizePhoneBR(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  if (!digits) return null
  const national = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits
  if (national.length !== 10 && national.length !== 11) return null
  return `+55${national}`
}
