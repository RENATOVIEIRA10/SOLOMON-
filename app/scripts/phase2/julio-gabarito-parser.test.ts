import assert from "node:assert/strict";
import { parseGabarito } from "./julio-gabarito-parser";

let passed = 0, total = 0;
function check(name: string, fn: () => void) { total++; fn(); passed++; console.log("ok -", name); }

const sample = `### Q47 — Prudential do Brasil · Vida Inteira
**Fatos:** Suicidio 18 meses apos contratacao.
\`RESPOSTA\` — Veredicto: NAO_COBERTO | Clausula decisiva: carencia suicidio 2 anos | Fatos ausentes: data exata | Confianca: alta | Justificativa: dentro da carencia | Doc consultado: CG v3`;

check("extracts id and verdict", () => {
  const rows = parseGabarito(sample);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "Q47");
  assert.equal(rows[0].verdict, "NAO_COBERTO");
  assert.equal(rows[0].confidence, "alta");
  assert.equal(rows[0].decisiveClause, "carencia suicidio 2 anos");
});

check("unfilled verdict is null", () => {
  const rows = parseGabarito("### Q99 — X · Y\n**Fatos:** z.\n`RESPOSTA` — Veredicto: ___ | Clausula decisiva: ___ | Confianca: ___");
  assert.equal(rows[0].verdict, null);
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
