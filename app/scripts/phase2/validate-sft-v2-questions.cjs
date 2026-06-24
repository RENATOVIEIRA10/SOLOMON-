#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// validate-sft-v2-questions.cjs
// Valida app/eval/fine_tuning/sft-v2-questions.jsonl (banco de perguntas SFT v2).
//
// Regras (cada falha => exit 1):
//   1. JSONL valido. Campos obrigatorios nao-vazios: id, category, question.
//      (insurer pode ser "" para perguntas conceituais aplicadas sem seguradora.)
//      IDs S-NNN unicos e sequenciais a partir de S-001.
//   2. Distribuicao por categoria validada POR LOTE (por range de IDs):
//      - Lote 1: S-001..S-180 (banco original) — TARGET_DISTRIBUTION_LOTE1, +/-20%.
//      - Lote 2: S-181..S-270 (top-up rendimento) — TARGET_DISTRIBUTION_LOTE2, +/-20%.
//      - Lote 3: S-271..S-390 (minimo 200 p/ Nova 2 Lite) — TARGET_DISTRIBUTION_LOTE3, +/-20%.
//      Motivo do relaxamento por-lote: o top-up tem distribuicao deliberadamente
//      DIFERENTE do lote 1 (mirada no rendimento medido por faithfulness do lote 1),
//      logo um unico alvo acumulado nao representa nenhum dos dois. Cada lote e
//      checado contra o alvo que o gerou. Lotes futuros adicionam novas faixas aqui.
//   3. Anti-contaminacao: similaridade Jaccard de trigramas de caracteres
//      (lowercase, sem acentos) contra TODAS as perguntas de eval existentes
//      (5 arquivos) E contra as perguntas do lote 1 (S-001..S-180) ao validar o
//      lote 2. FALHA se alguma similaridade > 0.55. Reporta os 5 pares mais
//      proximos mesmo quando passa. (Cada pergunta nao e comparada consigo mesma.)
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
// Regra 2: distribuicao alvo por categoria (+/-20%), validada POR LOTE.
// Cada lote tem um range de IDs e um alvo proprio. Para validar um lote,
// contam-se apenas as perguntas cujo numero de ID cai no [from, to] do lote.
// ---------------------------------------------------------------------------
const DIST_TOLERANCE = 0.2

// Lote 1 — banco original (S-001..S-180).
const TARGET_DISTRIBUTION_LOTE1 = {
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

// Lote 2 — top-up mirado no rendimento (S-181..S-270, 90 perguntas).
// Categorias proibidas neste lote (baixo aproveitamento / saturadas no lote 1):
// conceitos_aplicados, dit_dita, exclusoes, carencia_contestabilidade.
const TARGET_DISTRIBUTION_LOTE2 = {
  coberturas_produto: 22,
  invalidez: 16,
  doencas_graves: 14,
  assistencias: 12,
  sinistro_operacional: 14,
  beneficiarios_capital: 12,
}

// Lote 3 — minimo de 200 exemplos exigido pelo Nova 2 Lite (S-271..S-390, 120 perguntas).
// Reintroduz carencia_contestabilidade em volume reduzido (12) pois o foco do treino
// passou de rendimento de eval para cobertura de superficie do produto. dit_dita,
// exclusoes e conceitos_aplicados continuam fora (saturadas no lote 1).
const TARGET_DISTRIBUTION_LOTE3 = {
  coberturas_produto: 30,
  doencas_graves: 18,
  invalidez: 18,
  assistencias: 14,
  sinistro_operacional: 16,
  beneficiarios_capital: 12,
  carencia_contestabilidade: 12,
}

// Faixas de lote (from/to inclusivos sobre o numero do ID S-NNN).
const BATCHES = [
  { name: 'lote1 (S-001..S-180)', from: 1, to: 180, dist: TARGET_DISTRIBUTION_LOTE1 },
  { name: 'lote2 (S-181..S-270)', from: 181, to: 270, dist: TARGET_DISTRIBUTION_LOTE2 },
  { name: 'lote3 (S-271..S-390)', from: 271, to: 390, dist: TARGET_DISTRIBUTION_LOTE3 },
]

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

// Regra 2: distribuicao por categoria (+/-20%), validada POR LOTE.
function idNumber(id) {
  const m = ID_RE.exec(id || '')
  return m ? parseInt(m[1], 10) : null
}

// Distribuicao acumulada (apenas para o relatorio final).
const distribution = {}
for (const o of parsed) {
  if (o.category) distribution[o.category] = (distribution[o.category] || 0) + 1
}

// Cada lote so e validado quando tem perguntas no range (permite gerar
// incrementalmente sem falhar por um lote ainda vazio).
const batchDistributions = {}
for (const batch of BATCHES) {
  const inBatch = parsed.filter((o) => {
    const n = idNumber(o.id)
    return n !== null && n >= batch.from && n <= batch.to
  })
  const dist = {}
  for (const o of inBatch) {
    if (o.category) dist[o.category] = (dist[o.category] || 0) + 1
  }
  batchDistributions[batch.name] = dist

  if (inBatch.length === 0) continue // lote ainda nao gerado

  for (const [cat, target] of Object.entries(batch.dist)) {
    const actual = dist[cat] || 0
    const lo = Math.floor(target * (1 - DIST_TOLERANCE))
    const hi = Math.ceil(target * (1 + DIST_TOLERANCE))
    if (actual < lo || actual > hi) {
      errors.push(
        `[${batch.name}] Categoria '${cat}': esperado ${target} (+/-20% => ${lo}..${hi}), encontrado ${actual}.`,
      )
    }
  }
  // Categorias inesperadas DENTRO do lote (ex.: categoria proibida no top-up).
  for (const cat of Object.keys(dist)) {
    if (!(cat in batch.dist)) {
      errors.push(
        `[${batch.name}] Categoria inesperada/proibida neste lote: '${cat}' (${dist[cat]} perguntas).`,
      )
    }
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

// Regra 3: anti-contaminacao Jaccard.
// Compara cada pergunta contra: (a) todas as perguntas de eval (5 arquivos) e
// (b) as perguntas de OUTROS lotes do proprio arquivo SFT (ex.: lote 2 vs lote 1).
// Uma pergunta nunca e comparada consigo mesma nem com perguntas do mesmo lote
// (cohesao interna do lote ja foi garantida na autoria; o objetivo aqui e nao
// duplicar/parafrasear material de eval ou de lotes anteriores).
let existing = []
try {
  for (const f of EXISTING_FILES) {
    existing = existing.concat(readJsonlQuestions(f))
  }
} catch (err) {
  errors.push(`Falha ao carregar perguntas existentes: ${err.message}`)
}

function batchOf(id) {
  const n = idNumber(id)
  if (n === null) return null
  for (const b of BATCHES) {
    if (n >= b.from && n <= b.to) return b.name
  }
  return null
}

// Alvos de comparacao: eval (fonte externa) + perguntas SFT de lotes anteriores.
const sftAsTargets = parsed
  .filter((o) => o.question && o.id)
  .map((o) => ({ id: o.id, question: o.question, source: 'sft-v2-questions.jsonl', batch: batchOf(o.id) }))
const externalTrigrams = existing.map((e) => ({ ...e, batch: null, tg: charTrigrams(e.question) }))
const sftTrigrams = sftAsTargets.map((e) => ({ ...e, tg: charTrigrams(e.question) }))

const allPairs = []
for (const o of parsed) {
  if (!o.question) continue
  const tg = charTrigrams(o.question)
  const oBatch = batchOf(o.id)
  // (a) contra eval externo
  for (const e of externalTrigrams) {
    const sim = jaccard(tg, e.tg)
    allPairs.push({ sim, newId: o.id, newLine: o._line, oldId: e.id, oldSource: e.source })
  }
  // (b) contra perguntas SFT de OUTROS lotes (nao a propria, nao mesmo lote)
  for (const e of sftTrigrams) {
    if (e.id === o.id) continue
    if (oBatch !== null && e.batch === oBatch) continue
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
for (const batch of BATCHES) {
  const dist = batchDistributions[batch.name] || {}
  const count = Object.values(dist).reduce((a, b) => a + b, 0)
  if (count === 0) continue
  console.log(`Distribuicao ${batch.name} (alvo +/-20%):`)
  for (const [cat, target] of Object.entries(batch.dist)) {
    console.log(`  ${cat}: ${dist[cat] || 0} (alvo ${target})`)
  }
}
console.log('Distribuicao acumulada (todos os lotes):')
for (const cat of Object.keys(distribution).sort()) {
  console.log(`  ${cat}: ${distribution[cat]}`)
}
console.log('')
console.log(`Anti-contaminacao: ${existing.length} perguntas existentes comparadas, limite Jaccard ${JACCARD_THRESHOLD}.`)
console.log('Top 5 pares mais proximos:')
for (const p of allPairs.slice(0, 5)) {
  console.log(`  ${p.newId} ~ ${p.oldId} [${p.oldSource}] Jaccard=${p.sim.toFixed(3)}`)
}
for (const warn of warnings) console.log(`AVISO: ${warn}`)
process.exit(0)
