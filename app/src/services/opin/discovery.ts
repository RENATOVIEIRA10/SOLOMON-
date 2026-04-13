/**
 * OPIN Participant Directory Discovery
 *
 * Discovers insurer endpoints from the Open Insurance Brazil participant directory.
 * Falls back to a hardcoded list of known working endpoints.
 */

const OPIN_DIRECTORY_URL = 'https://data.directory.opinbrasil.com.br/participants'

export interface DiscoveredInsurer {
  name: string
  cnpj: string
  endpoint_base: string
}

export const KNOWN_INSURERS = [
  { name: 'Prudential do Brasil', cnpj: '36.542.459/0001-64', endpoint: 'https://auth-opin-prd.prudential.com.br' },
  { name: 'Bradesco Seguros', cnpj: '51.990.695/0001-37', endpoint: 'https://opin.bradescoseguros.com.br' },
  { name: 'Porto Seguro', cnpj: '61.198.164/0001-60', endpoint: 'https://open-api.portoseguro.com.br' },
  { name: 'Icatu Seguros', cnpj: '42.283.770/0001-39', endpoint: 'https://opin.icatuseguros.com.br' },
  { name: 'MAPFRE Seguros', cnpj: '61.074.175/0001-38', endpoint: 'https://api-openinsurance.mapfre.com.br' },
  { name: 'Tokio Marine', cnpj: '33.164.021/0001-00', endpoint: 'https://auth.tokiomarine.com.br' },
  { name: 'SulAmerica', cnpj: '01.685.053/0001-56', endpoint: 'https://api.sulamericaseguros.opinb3.com.br' },
  { name: 'Zurich', cnpj: '01.585.284/0001-38', endpoint: 'https://opin.zurich.com.br' },
  { name: 'Caixa Vida e Previdencia', cnpj: '03.730.204/0001-76', endpoint: 'https://api.caixavidaeprevidencia.com.br' },
  { name: 'Santander Auto/RE', cnpj: '67.959.424/0001-24', endpoint: 'https://zurichsantander.api.santander.com.br' },
] as const

/**
 * Relevant OPIN API family IDs for life insurance products.
 */
const RELEVANT_API_FAMILIES = ['life-pension', 'person']

interface OPINParticipant {
  OrganisationName: string
  RegistrationNumber: string
  AuthorisationServers?: Array<{
    ApiResources?: Array<{
      ApiFamilyType?: string
      ApiDiscoveryEndpoints?: Array<{
        ApiEndpoint?: string
      }>
    }>
  }>
}

/**
 * Fetches the OPIN participant directory and filters for insurers
 * that expose life-pension or person product APIs.
 */
export async function discoverInsurers(): Promise<DiscoveredInsurer[]> {
  console.log('[discovery] Fetching OPIN participant directory...')

  try {
    const response = await fetch(OPIN_DIRECTORY_URL, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const participants: OPINParticipant[] = await response.json()
    console.log(`[discovery] Found ${participants.length} total participants`)

    const insurers: DiscoveredInsurer[] = []

    for (const participant of participants) {
      const servers = participant.AuthorisationServers ?? []

      for (const server of servers) {
        const resources = server.ApiResources ?? []

        const hasRelevantApi = resources.some((r) =>
          RELEVANT_API_FAMILIES.includes(r.ApiFamilyType ?? '')
        )

        if (!hasRelevantApi) continue

        // Find the base endpoint from the first relevant API resource
        const relevantResource = resources.find((r) =>
          RELEVANT_API_FAMILIES.includes(r.ApiFamilyType ?? '')
        )
        const endpoints = relevantResource?.ApiDiscoveryEndpoints ?? []
        const firstEndpoint = endpoints[0]?.ApiEndpoint

        if (!firstEndpoint) continue

        // Extract base URL (protocol + host)
        try {
          const url = new URL(firstEndpoint)
          const endpointBase = `${url.protocol}//${url.host}`

          insurers.push({
            name: participant.OrganisationName,
            cnpj: participant.RegistrationNumber,
            endpoint_base: endpointBase,
          })
        } catch {
          console.warn(`[discovery] Invalid URL for ${participant.OrganisationName}: ${firstEndpoint}`)
        }
      }
    }

    // Deduplicate by CNPJ
    const seen = new Set<string>()
    const unique = insurers.filter((ins) => {
      if (seen.has(ins.cnpj)) return false
      seen.add(ins.cnpj)
      return true
    })

    console.log(`[discovery] Found ${unique.length} insurers with life/person APIs`)
    return unique
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[discovery] Failed to fetch directory: ${message}`)
    console.log('[discovery] Falling back to hardcoded insurer list')
    return getFallbackInsurers()
  }
}

/**
 * Returns the hardcoded fallback list as DiscoveredInsurer[].
 */
export function getFallbackInsurers(): DiscoveredInsurer[] {
  return KNOWN_INSURERS.map((ins) => ({
    name: ins.name,
    cnpj: ins.cnpj,
    endpoint_base: ins.endpoint,
  }))
}
