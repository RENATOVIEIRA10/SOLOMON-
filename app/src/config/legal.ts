/**
 * SSoT dos documentos legais do SOLOMON.
 *
 * A versão é gravada no consentimento do corretor (checkout/primeiro login) para
 * provar QUAL texto ele aceitou e QUANDO — requisito de accountability da LGPD.
 * Ao alterar materialmente Política ou Termos, subir a versão e a data aqui.
 */
export const LEGAL = {
  privacy: { version: "1.0", updatedAt: "2026-07-06" },
  terms: { version: "1.0", updatedAt: "2026-07-06" },
  contactEmail: "contato@aurios.com.br",
  controller: "AUR.IOs",
} as const

export type LegalDocVersions = {
  privacyVersion: string
  termsVersion: string
}

/** Versões vigentes, para gravar no consentimento. */
export function currentLegalVersions(): LegalDocVersions {
  return { privacyVersion: LEGAL.privacy.version, termsVersion: LEGAL.terms.version }
}
