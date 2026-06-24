#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// validate-heldout.cjs
// Valida app/eval/fine_tuning/solomon-guardrails-heldout.jsonl
// Regras:
//   - Exatamente 12 linhas nao-vazias
//   - Cada linha e JSON valido com chaves id, category, question, ground_truth nao-vazias
//   - IDs unicos com prefixo G-
//   - Distribuicao de categorias: calculation=3, missing_source=2, scope=3, pre_sinistro=2, contract_concept=2
// Sai com codigo 1 se qualquer regra falhar.

'use strict'

const fs = require('fs')
const path = require('path')

const EXPECTED_COUNT = 12
const REQUIRED_KEYS = ['id', 'category', 'question', 'ground_truth']
const EXPECTED_DISTRIBUTION = {
  calculation: 3,
  missing_source: 2,
  scope: 3,
  pre_sinistro: 2,
  contract_concept: 2,
}
const ID_PREFIX_RE = /^G-/

const filePath = path.resolve(__dirname, '../../eval/fine_tuning/solomon-guardrails-heldout.jsonl')

let errors = []
let lines

try {
  const raw = fs.readFileSync(filePath, 'utf8')
  lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
} catch (err) {
  console.error(`ERRO: nao foi possivel ler o arquivo: ${filePath}`)
  console.error(err.message)
  process.exit(1)
}

// Regra 1: quantidade de linhas
if (lines.length !== EXPECTED_COUNT) {
  errors.push(`Esperado ${EXPECTED_COUNT} linhas, encontrado ${lines.length}.`)
}

const parsed = []
const seenIds = new Set()

for (let i = 0; i < lines.length; i++) {
  const lineNum = i + 1
  let obj

  // Regra 2: JSON valido
  try {
    obj = JSON.parse(lines[i])
  } catch (err) {
    errors.push(`Linha ${lineNum}: JSON invalido — ${err.message}`)
    continue
  }

  // Regra 3: chaves obrigatorias nao-vazias
  for (const key of REQUIRED_KEYS) {
    if (!obj[key] || typeof obj[key] !== 'string' || obj[key].trim() === '') {
      errors.push(`Linha ${lineNum}: campo '${key}' ausente ou vazio.`)
    }
  }

  // Regra 4: prefixo G- no id
  if (obj.id && !ID_PREFIX_RE.test(obj.id)) {
    errors.push(`Linha ${lineNum}: id '${obj.id}' nao tem prefixo G-.`)
  }

  // Regra 5: ids unicos
  if (obj.id) {
    if (seenIds.has(obj.id)) {
      errors.push(`Linha ${lineNum}: id '${obj.id}' duplicado.`)
    } else {
      seenIds.add(obj.id)
    }
  }

  parsed.push(obj)
}

// Regra 6: distribuicao de categorias
const distribution = {}
for (const obj of parsed) {
  if (obj.category) {
    distribution[obj.category] = (distribution[obj.category] || 0) + 1
  }
}

for (const [cat, expectedCount] of Object.entries(EXPECTED_DISTRIBUTION)) {
  const actual = distribution[cat] || 0
  if (actual !== expectedCount) {
    errors.push(`Categoria '${cat}': esperado ${expectedCount}, encontrado ${actual}.`)
  }
}

// Resultado
if (errors.length > 0) {
  console.error('FALHA — validate-heldout.cjs encontrou os seguintes erros:')
  for (const err of errors) {
    console.error(`  - ${err}`)
  }
  process.exit(1)
}

console.log('OK — solomon-guardrails-heldout.jsonl valido.')
console.log(`Total: ${parsed.length} casos.`)
console.log('Distribuicao por categoria:')
for (const [cat, count] of Object.entries(distribution)) {
  console.log(`  ${cat}: ${count}`)
}
process.exit(0)
