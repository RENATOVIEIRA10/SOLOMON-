/**
 * H11 guard regression test — GRD-04
 *
 * Verifica que hasEvidenceFor retorna false para chunks sem keywords
 * de cobertura ou exclusao, garantindo que qualquer veredicto conclusivo
 * (COBERTO ou NAO_COBERTO) seria rebaixado a RISCO pelo post-validation
 * block quando o conjunto de resultados nao tem suporte textual.
 *
 * Run from app/:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/pre-sinistro-h11-guard.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import { hasEvidenceFor } from '@/services/rag/pre-sinistro'
import type { SearchResult } from '@/services/rag/search'

let passed = 0
let failed = 0

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`  ok  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}${detail ? ` (${detail})` : ''}`)
  }
}

// Fixtures
const chunkCobertura: SearchResult = {
  id: 'chunk-cobertura',
  content: 'Esta clausula garante cobertura total por morte natural ou acidental conforme as condicoes gerais.',
  similarity: 0.85,
  metadata: {},
  source_url: null,
  source_type: 'pdf',
  product_id: null,
  insurer_id: 'test',
}

const chunkExclusao: SearchResult = {
  id: 'chunk-exclusao',
  content: 'O presente contrato exclui eventos decorrentes de preexistencias nao declaradas na proposta.',
  similarity: 0.80,
  metadata: {},
  source_url: null,
  source_type: 'pdf',
  product_id: null,
  insurer_id: 'test',
}

// H11: chunk generico — sem nenhuma keyword de cobertura nem exclusao
const chunkGenerico: SearchResult = {
  id: 'chunk-generico',
  content: 'O presente contrato foi celebrado entre as partes na data indicada na proposta.',
  similarity: 0.60,
  metadata: {},
  source_url: null,
  source_type: 'pdf',
  product_id: null,
  insurer_id: 'test',
}

// --- Gate functions ---

function gateCoberturaKeywordDetected(): void {
  console.log('\n## hasEvidenceFor — COBERTO com chunk de cobertura')
  ok(
    'hasEvidenceFor(COBERTO, [chunkCobertura]) === true',
    hasEvidenceFor('COBERTO', [chunkCobertura]),
  )
}

function gateExclusaoKeywordDetected(): void {
  console.log('\n## hasEvidenceFor — NAO_COBERTO com chunk de exclusao')
  ok(
    'hasEvidenceFor(NAO_COBERTO, [chunkExclusao]) === true',
    hasEvidenceFor('NAO_COBERTO', [chunkExclusao]),
  )
}

function gateH11CoberturaFalse(): void {
  console.log('\n## hasEvidenceFor — H11: chunk generico nao tem cobertura')
  ok(
    'hasEvidenceFor(COBERTO, [chunkGenerico]) === false',
    hasEvidenceFor('COBERTO', [chunkGenerico]) === false,
  )
}

function gateH11ExclusaoFalse(): void {
  console.log('\n## hasEvidenceFor — H11: chunk generico nao tem exclusao')
  ok(
    'hasEvidenceFor(NAO_COBERTO, [chunkGenerico]) === false',
    hasEvidenceFor('NAO_COBERTO', [chunkGenerico]) === false,
  )
}

function gateH11Combined(): void {
  console.log('\n## hasEvidenceFor — H11 combinado: ambos false => post-validation forcaria RISCO')
  const hasCobertura = hasEvidenceFor('COBERTO', [chunkGenerico])
  const hasExclusao = hasEvidenceFor('NAO_COBERTO', [chunkGenerico])
  ok(
    'chunk generico: hasEvidenceFor(COBERTO) === false',
    hasCobertura === false,
    `got ${hasCobertura}`,
  )
  ok(
    'chunk generico: hasEvidenceFor(NAO_COBERTO) === false',
    hasExclusao === false,
    `got ${hasExclusao}`,
  )
  ok(
    'H11 ambos false => qualquer veredicto conclusivo seria rebaixado a RISCO',
    hasCobertura === false && hasExclusao === false,
  )
}

// --- Run ---

gateCoberturaKeywordDetected()
gateExclusaoKeywordDetected()
gateH11CoberturaFalse()
gateH11ExclusaoFalse()
gateH11Combined()

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`)
  process.exit(1)
}

console.log(`\n${passed} passed`)
