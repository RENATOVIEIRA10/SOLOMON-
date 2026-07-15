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

check("invalid (non-enum) verdict and confidence parse as null", () => {
  const rows = parseGabarito(
    "### Q98 — X · Y\n**Fatos:** z.\n`RESPOSTA` — Veredicto: TALVEZ | Clausula decisiva: alguma | Confianca: mais ou menos | Justificativa: incerto",
  );
  assert.equal(rows[0].verdict, null);
  assert.equal(rows[0].confidence, null);
});

check("CRLF line endings still parse (finding #1)", () => {
  const crlf = sample.replace(/\n/g, "\r\n");
  const rows = parseGabarito(crlf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "Q47");
  assert.equal(rows[0].verdict, "NAO_COBERTO");
  assert.equal(rows[0].confidence, "alta");
  assert.equal(rows[0].decisiveClause, "carencia suicidio 2 anos");
  assert.equal(rows[0].justification, "dentro da carencia");
});

check("RESPOSTA block wrapped across two physical lines is fully captured (finding #2)", () => {
  const wrapped = [
    "### Q47 — Prudential do Brasil · Vida Inteira",
    "**Fatos:** Suicidio 18 meses apos contratacao.",
    "`RESPOSTA` — Veredicto: NAO_COBERTO | Clausula decisiva: carencia suicidio 2 anos |",
    "Confianca: alta | Justificativa: dentro da carencia, sem duvida | Doc consultado: CG v3",
  ].join("\n");
  const rows = parseGabarito(wrapped);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, "NAO_COBERTO");
  assert.equal(rows[0].confidence, "alta");
  assert.equal(rows[0].justification, "dentro da carencia, sem duvida");
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
