/**
 * F1: multi-query fan-out — buildSubQueries() unit test.
 *
 * Cobre a decomposicao pura do caso em sub-queries por dimensao
 * (cobertura / exclusao / carencia / faixa etaria / base+produto).
 * Zero I/O (sem DB, sem embed, sem LLM) — determinístico.
 *
 * Run from app/:
 *   npx tsx scripts/phase2/pre-sinistro-subqueries.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import assert from "node:assert/strict";
import { buildSubQueries } from "../../src/services/rag/pre-sinistro";

let passed = 0,
  total = 0;
function check(name: string, fn: () => void) {
  total++;
  fn();
  passed++;
  console.log("ok -", name);
}

check("produces one query per coverage dimension", () => {
  const qs = buildSubQueries({
    insurerName: "Prudential do Brasil",
    claimType: "morte_por_suicidio",
    description: "suicidio 18 meses",
  });
  assert.ok(qs.length >= 4);
  assert.ok(qs.some((q) => /car[eê]ncia/i.test(q)));
  assert.ok(qs.some((q) => /exclus/i.test(q)));
  assert.ok(qs.some((q) => /cobertura/i.test(q)));
});

check("includes productHint in each dimensioned query when provided", () => {
  const qs = buildSubQueries({
    insurerName: "MAG Seguros",
    claimType: "invalidez",
    description: "acidente de trabalho, perda de movimento no braco",
    productHint: "MAG Vida Total",
  });
  assert.ok(qs.length >= 5);
  assert.ok(qs.every((q) => q.includes("MAG Vida Total")));
});

check("base+product query keeps claimType and description verbatim", () => {
  const qs = buildSubQueries({
    insurerName: "Prudential do Brasil",
    claimType: "doenca_grave",
    description: "diagnostico de cancer aos 52 anos",
  });
  const last = qs[qs.length - 1];
  assert.equal(last, "doenca_grave diagnostico de cancer aos 52 anos");
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
