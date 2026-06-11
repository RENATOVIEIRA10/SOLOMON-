#!/usr/bin/env node
// validate-sft-v2-questions.cjs
// Valida app/eval/fine_tuning/sft-v2-questions.jsonl (banco de perguntas SFT v2).
//
// Regras (cada falha => exit 1):
//   1. JSONL valido. Campos obrigatorios nao-vazios: id, category, question.
//      (insurer pode ser "" para perguntas conceituais aplicadas sem seguradora.)
//      IDs S-NNN unicos e sequenciais a partir de S-001.
//   2. Contagem por categoria dentro de +/-20% da distribuicao alvo.
//   3. Anti-contaminacao: similaridade Jaccard de trigramas de caracteres
//      (lowercase, sem acentos) contra TODAS as 145 perguntas existentes
//      (5 arquivos). FALHA se alguma similaridade > 0.55. Reporta os 5 pares
//      mais proximos mesmo quando passa.
//   4. Guards estaticos: regex que detecta padroes proibidos —
//      pedido de calculo, veredicto de sinistro, dominios proibidos,
//      seguradoras nao-indexadas.
//
// Uso: node app/scripts/phase2/validate-sft-v2-questions.cjs

'use strict'

const fs = require('fs')
const path = require('path')

// ---------------------------------------------------------------------------
// Caminhos
// ---------------------------------------------------------------------------
const EVAL_DIR = path.resolve(__dirname, '../../eval')
const NEW_FILE = path.join(EVAL_DIR, 'fine_tuning/sft-v2-questions.jsonl')

// As 145 perguntas existentes (PROIBIDO parafrasear).
const EXISTING_FILES = [
  path.join(EVAL_DIR, 'ragas/questions.jsonl'), // 50 (Q01-Q50)
  path.join(EVAL_DIR, 'ragas/questions_commercial.jsonl'), // 6
  path.join(EVAL_DIR, 'ragas/questions_comparison.jsonl'), // 10 (Q31-Q40)
  path.join(EVAL_DIR, 'ragas/questions_sft_expansion.jsonl'), // 67 (SFT001-SFT067)
  path.join(EVAL_DIR, 'fine_tuning/solomon-guardrails-heldout.jsonl'), // 12 (G-*)
]

// ---------------------------------------------------------------------------
// Regra 1: campos obrigatorios + IDs sequenciais
// ---------------------------------------------------------------------------
const REQUIRED_KEYS = ['id', 'category', 'question'] // insurer pode ser vazio
const ID_RE = /^S-(\d{3})$/

// ---------------------------------------------------------------------------
// Regra 2: distribuicao alvo por categoria (+/-20%)
// ---------------------------------------------------------------------------
const TARGET_DISTRIBUTION = {
  coberturas_produto: 35,
  exclusoes: 30,
  carencia_contestabilidade: 20,
  sinistro_operacional: 20,
  dit_dita: 15,
  doencas_graves: 15,
  invalidez: 15,
  beneficiarios_capital: 10,
  assistencias: 10,
  conceitos_aplicados: 10,
}
const DIST_TOLERANCE = 0.2

// ---------------------------------------------------------------------------
// Regra 3: limite Jaccard de trigramas
// ---------------------------------------------------------------------------
const JACCARD_THRESHOLD = 0.55

// ---------------------------------------------------------------------------
// Regra 4: guards estaticos (regex)
// ---------------------------------------------------------------------------
const FORBIDDEN_PATTERNS = [
  {
    name: 'pedido de calculo de premio/taxa',
    re: /\d+\s*anos.*capital|qual o premio|quanto custa|qual o pr[eê]mio/i,
  },
  {
    name: 'veredicto de sinistro concreto',
    re: /(faleceu|morreu|sofreu)[\s\S]*?(coberto|paga|indeniza)/i,
  },
  {
    name: 'dominio proibido (auto/residencial/viagem)',
    re: /seguro\s+(auto|residencial|viagem)/i,
  },
  {
    name: 'seguradora nao-indexada',
    re: /\b(allianz|axa|chubb|generali|capemisa|liberty|hdi|sompo)\b/i,
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normalizeForTrigrams(s) {
  return stripAccents(String(s).toLowerCase())
    .replace(/\s+/g, ' ')
    .trim()
}

function charTrigrams(s) {
  const norm = normalizeForTrigrams(s)
  const set = new Set()
  if (norm.length < 3) {
    if (norm.length > 0) set.add(norm)
    return set
  }
  for (let i = 0; i <= norm.length - 3; i++) {
    set.add(norm.slice(i, i + 3))
  }
  return set
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0
  let inter = 0
  for (const t of setA) {
    if (setB.has(t)) inter++
  }
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : inter / union
}

function readJsonlQuestions(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const out = []
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  for (let i = 0; i < lines.length; i++) {
    let obj
    try {
      obj = JSON.parse(lines[i])
    } catch (err) {
      throw new Error(`${path.basename(filePath)} linha ${i + 1}: JSON invalido — ${err.message}`)
    }
    if (obj && typeof obj.question === 'string') {
      out.push({ id: obj.id, question: obj.question, source: path.basename(filePath) })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Execucao
// ---------------------------------------------------------------------------
const errors = []
const warnings = []

// Carrega arquivo novo
let newLines
try {
  const raw = fs.readFileSync(NEW_FILE, 'utf8')
  newLines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
} catch (err) {
  console.error(`ERRO: nao foi possivel ler ${NEW_FILE}`)
  console.error(err.message)
  process.exit(1)
}

const parsed = []
const seenIds = new Set()

for (let i = 0; i < newLines.length; i++) {
  const lineNum = i + 1
  let obj
  try {
    obj = JSON.parse(newLines[i])
  } catch (err) {
    errors.push(`Linha ${lineNum}: JSON invalido — ${err.message}`)
    continue
  }

  // Campos obrigatorios nao-vazios
  for (const key of REQUIRED_KEYS) {
    if (!obj[key] || typeof obj[key] !== 'string' || obj[key].trim() === '') {
      errors.push(`Linha ${lineNum}: campo '${key}' ausente ou vazio.`)
    }
  }
  // insurer precisa existir como chave (string, pode ser vazia)
  if (typeof obj.insurer !== 'string') {
    errors.push(`Linha ${lineNum}: campo 'insurer' ausente ou nao-string.`)
  }

  // Formato e unicidade do id
  if (obj.id) {
    if (!ID_RE.test(obj.id)) {
      errors.push(`Linha ${lineNum}: id '${obj.id}' nao segue o padrao S-NNN.`)
    }
    if (seenIds.has(obj.id)) {
      errors.push(`Linha ${lineNum}: id '${obj.id}' duplicado.`)
    } else {
      seenIds.add(obj.id)
    }
  }

  parsed.push({ ...obj, _line: lineNum })
}

// IDs sequenciais a partir de S-001
const validIdObjs = parsed.filter((o) => o.id && ID_RE.test(o.id))
for (let i = 0; i < validIdObjs.length; i++) {
  const expected = `S-${String(i + 1).padStart(3, '0')}`
  if (validIdObjs[i].id !== expected) {
    errors.push(
      `IDs nao sequenciais: posicao ${i + 1} esperava '${expected}', encontrou '${validIdObjs[i].id}'.`,
    )
    break
  }
}

// Regra 2: distribuicao por categoria (+/-20%)
const distribution = {}
for (const o of parsed) {
  if (o.category) distribution[o.category] = (distribution[o.category] || 0) + 1
}
for (const [cat, target] of Object.entries(TARGET_DISTRIBUTION)) {
  const actual = distribution[cat] || 0
  const lo = Math.floor(target * (1 - DIST_TOLERANCE))
  const hi = Math.ceil(target * (1 + DIST_TOLERANCE))
  if (actual < lo || actual > hi) {
    errors.push(
      `Categoria '${cat}': esperado ${target} (+/-20% => ${lo}..${hi}), encontrado ${actual}.`,
    )
  }
}
// Categorias inesperadas
for (const cat of Object.keys(distribution)) {
  if (!(cat in TARGET_DISTRIBUTION)) {
    errors.push(`Categoria inesperada '${cat}' (${distribution[cat]} perguntas).`)
  }
}

// Regra 4: guards estaticos
for (const o of parsed) {
  if (!o.question) continue
  for (const g of FORBIDDEN_PATTERNS) {
    if (g.re.test(o.question)) {
      errors.push(`Linha ${o._line} (${o.id || '?'}): padrao proibido [${g.name}] na pergunta: "${o.question}"`)
    }
  }
}

// Regra 3: anti-contaminacao Jaccard
let existing = []
try {
  for (const f of EXISTING_FILES) {
    existing = existing.concat(readJsonlQuestions(f))
  }
} catch (err) {
  errors.push(`Falha ao carregar perguntas existentes: ${err.message}`)
}

const existingTrigrams = existing.map((e) => ({ ...e, tg: charTrigrams(e.question) }))
const allPairs = []
for (const o of parsed) {
  if (!o.question) continue
  const tg = charTrigrams(o.question)
  for (const e of existingTrigrams) {
    const sim = jaccard(tg, e.tg)
    allPairs.push({ sim, newId: o.id, newLine: o._line, oldId: e.id, oldSource: e.source })
  }
}
allPairs.sort((a, b) => b.sim - a.sim)

for (const p of allPairs) {
  if (p.sim > JACCARD_THRESHOLD) {
    errors.push(
      `Contaminacao: ${p.newId} (linha ${p.newLine}) ~ ${p.oldId} [${p.oldSource}] Jaccard=${p.sim.toFixed(3)} > ${JACCARD_THRESHOLD}.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Relatorio
// ---------------------------------------------------------------------------
if (errors.length > 0) {
  console.error('FALHA — validate-sft-v2-questions.cjs encontrou os seguintes erros:')
  for (const err of errors) console.error(`  - ${err}`)
  console.error('')
  console.error(`Total de perguntas novas: ${parsed.length}`)
  console.error('Top 5 pares mais proximos (anti-contaminacao):')
  for (const p of allPairs.slice(0, 5)) {
    console.error(
      `  ${p.newId} ~ ${p.oldId} [${p.oldSource}] Jaccard=${p.sim.toFixed(3)}`,
    )
  }
  process.exit(1)
}

console.log('OK — sft-v2-questions.jsonl valido.')
console.log(`Total: ${parsed.length} perguntas.`)
console.log('Distribuicao por categoria (alvo +/-20%):')
for (const [cat, target] of Object.entries(TARGET_DISTRIBUTION)) {
  console.log(`  ${cat}: ${distribution[cat] || 0} (alvo ${target})`)
}
console.log('')
console.log(`Anti-contaminacao: ${existing.length} perguntas existentes comparadas, limite Jaccard ${JACCARD_THRESHOLD}.`)
console.log('Top 5 pares mais proximos:')
for (const p of allPairs.slice(0, 5)) {
  console.log(`  ${p.newId} ~ ${p.oldId} [${p.oldSource}] Jaccard=${p.sim.toFixed(3)}`)
}
for (const warn of warnings) console.log(`AVISO: ${warn}`)
process.exit(0)
