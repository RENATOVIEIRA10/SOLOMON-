/**
 * Regressao GRD-02 — lexico de seguradoras conhecidas-mas-nao-indexadas.
 *
 * Gap encontrado em smoke pos-merge da PR #67 (2026-06-10): detectInsurers so
 * conhecia as 13 seguradoras indexadas, entao pergunta sobre Allianz (ausente
 * da base) nem era detectada -> GRD-02 nunca disparava -> fallback global com
 * chunks de outras seguradoras + recusa probabilistica do LLM (classe H05).
 *
 * Com o lexico estendido, detectInsurers reconhece a seguradora ausente e o
 * insurer-source-guard recusa por construcao (resolveInsurerIds vazio -> !hasMatch).
 *
 * Rodar: npx tsx --tsconfig scripts/tsconfig.json scripts/phase2/insurer-lexicon.test.ts
 */
import { detectInsurers } from '../../src/services/rag/answer'

let passed = 0
let failed = 0

function check(name: string, cond: boolean) {
  if (cond) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.error(`  FAIL ${name}`)
  }
}

console.log('== Seguradoras NAO indexadas devem ser detectadas (gatilho do GRD-02) ==')
check('Allianz', detectInsurers('Quais as coberturas do seguro de vida da Allianz?').includes('Allianz'))
check('Capemisa (G-04)', detectInsurers('Condicoes de invalidez do seguro de vida da Capemisa?').includes('Capemisa'))
check('Itau Vida', detectInsurers('O Itaú Vida cobre doencas graves?').includes('Itau'))
check('AXA', detectInsurers('A AXA tem seguro de vida individual?').includes('AXA'))
check('Seguros Unimed', detectInsurers('carencia do seguros unimed vida total').includes('Seguros Unimed'))
check('MetLife continua detectada (indexada)', detectInsurers('cobertura da MetLife para invalidez').includes('MetLife'))
check('SulAmerica continua detectada (indexada, 563 chunks)', detectInsurers('condicoes da SulAmerica Vida').includes('SulAmerica'))

console.log('== Falsos positivos proibidos ==')
check('"taxa" NAO dispara AXA', !detectInsurers('A taxa mensal e 2,30 por mil. Qual o premio?').includes('AXA'))
check('"taxas" NAO dispara AXA', !detectInsurers('Como funcionam as taxas de carregamento?').includes('AXA'))
check('pergunta sem seguradora -> []', detectInsurers('O que e capital segurado?').length === 0)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
