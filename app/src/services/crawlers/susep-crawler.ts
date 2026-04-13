/**
 * SUSEP Crawler
 *
 * Validates SUSEP process numbers and enriches product data.
 *
 * The full SUSEP consultation page (susep.gov.br) uses ASP.NET forms
 * requiring JavaScript rendering, which is too heavy for a 4GB RAM machine.
 *
 * MVP approach:
 *   - Validate SUSEP process number format
 *   - Store validation results in product metadata
 *   - TODO: Full scraping will run on VPS with Playwright
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

/**
 * SUSEP process number format:
 * 15414.XXXXXX/YYYY-XX (most common)
 * or variations like XXXXX.XXXXXX/YYYY-XX
 *
 * Examples:
 *   15414.900988/2020-01
 *   15414.001087/2004-77
 */
const SUSEP_PROCESS_PATTERN = /^\d{5}\.\d{6}\/\d{4}-\d{2}$/

/**
 * Validates a SUSEP process number format.
 * Does NOT verify if the process actually exists at SUSEP.
 */
export function validateSUSEPProcess(process: string): boolean {
  if (!process || typeof process !== 'string') return false
  const cleaned = process.trim()
  return SUSEP_PROCESS_PATTERN.test(cleaned)
}

/**
 * Extracts the components of a SUSEP process number.
 */
export function parseSUSEPProcess(process: string): {
  prefix: string
  number: string
  year: string
  suffix: string
} | null {
  const match = process.trim().match(/^(\d{5})\.(\d{6})\/(\d{4})-(\d{2})$/)
  if (!match) return null

  return {
    prefix: match[1],
    number: match[2],
    year: match[3],
    suffix: match[4],
  }
}

/**
 * Enriches a product with SUSEP metadata.
 *
 * For MVP: validates the process number and stores validation status.
 * TODO: When running on VPS with Playwright, this will scrape the actual
 * SUSEP consultation page to retrieve:
 *   - Product registration status (active/suspended/cancelled)
 *   - Registration date
 *   - Last update date
 *   - Insurer name (as registered at SUSEP)
 *   - Product category (as classified by SUSEP)
 */
export async function enrichWithSUSEP(
  db: SupabaseClient<Database>,
  productId: string,
  susepProcess: string
): Promise<{ valid: boolean; message: string }> {
  const isValid = validateSUSEPProcess(susepProcess)
  const parsed = isValid ? parseSUSEPProcess(susepProcess) : null

  const metadata: Record<string, unknown> = {
    susep_validated_at: new Date().toISOString(),
    susep_format_valid: isValid,
    susep_parsed: parsed,
    // TODO: Add these fields when VPS Playwright scraping is available
    // susep_status: 'active' | 'suspended' | 'cancelled',
    // susep_registration_date: '2020-01-15',
    // susep_insurer_name: 'Nome registrado na SUSEP',
  }

  const { error } = await db
    .from('products')
    .update({
      raw_data: metadata as unknown as Json,
    })
    .eq('id', productId)

  if (error) {
    console.error(`[susep] Failed to update product ${productId}: ${error.message}`)
    return { valid: isValid, message: `DB error: ${error.message}` }
  }

  if (!isValid) {
    console.warn(`[susep] Invalid SUSEP process format: "${susepProcess}" for product ${productId}`)
    return { valid: false, message: `Invalid format: "${susepProcess}"` }
  }

  console.log(`[susep] Validated SUSEP process: ${susepProcess} for product ${productId}`)
  return { valid: true, message: `Format OK: ${susepProcess}` }
}

/**
 * Validates all products that have a susep_process but haven't been validated yet.
 * Returns the count of validated products.
 */
export async function validateAllSUSEPProcesses(
  db: SupabaseClient<Database>
): Promise<{ validated: number; invalid: number; errors: number }> {
  console.log('[susep] Fetching products with SUSEP process numbers...')

  const { data: products, error } = await db
    .from('products')
    .select('id, susep_process, name')
    .not('susep_process', 'is', null)

  if (error) {
    console.error(`[susep] Failed to fetch products: ${error.message}`)
    return { validated: 0, invalid: 0, errors: 1 }
  }

  if (!products || products.length === 0) {
    console.log('[susep] No products with SUSEP process numbers found')
    return { validated: 0, invalid: 0, errors: 0 }
  }

  console.log(`[susep] Found ${products.length} products to validate`)

  let validated = 0
  let invalid = 0
  let errors = 0

  for (const product of products) {
    if (!product.susep_process) continue

    const result = await enrichWithSUSEP(db, product.id, product.susep_process)

    if (result.message.startsWith('DB error')) {
      errors++
    } else if (result.valid) {
      validated++
    } else {
      invalid++
    }
  }

  console.log(`[susep] Done: ${validated} valid, ${invalid} invalid, ${errors} errors`)
  return { validated, invalid, errors }
}
