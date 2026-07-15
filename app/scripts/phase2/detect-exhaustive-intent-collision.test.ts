/**
 * Fix wave 1 (Task 6 F1 fan-out silent-failure fix): locks the awareness
 * that detectExhaustiveIntent() DOES fire for the "exclusoes"/"carencia"
 * sub-query templates emitted by buildSubQueries() in pre-sinistro.ts.
 *
 * This collision is exactly why hybridSearchWithEmbedding() calls in the
 * pre-sinistro fan-out now pass `disableExhaustiveIntent: true` -- without
 * it, those two sub-queries would bypass vector search entirely and hit
 * fetchChunksByToc()'s positional (document-order) slice instead of
 * semantic relevance ranking.
 *
 * Zero I/O (sem DB, sem embed, sem LLM) -- deterministico.
 *
 * Run from app/:
 *   npx tsx scripts/phase2/detect-exhaustive-intent-collision.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import assert from "node:assert/strict";
import { detectExhaustiveIntent } from "../../src/services/rag/search";
import { buildSubQueries } from "../../src/services/rag/pre-sinistro";

let passed = 0,
  total = 0;
function check(name: string, fn: () => void) {
  total++;
  fn();
  passed++;
  console.log("ok -", name);
}

check("detectExhaustiveIntent still fires for 'exclusoes'", () => {
  const result = detectExhaustiveIntent("quais sao as exclusoes deste produto?");
  assert.equal(result.isExhaustive, true);
  assert.equal(result.sectionQuery, "exclu");
});

check("detectExhaustiveIntent still fires for 'carencia'", () => {
  const result = detectExhaustiveIntent("qual a carencia deste produto?");
  assert.equal(result.isExhaustive, true);
  assert.equal(result.sectionQuery, "carenc");
});

check("buildSubQueries emits sub-queries that collide with detectExhaustiveIntent", () => {
  const subQueries = buildSubQueries({
    insurerName: "Prudential do Brasil",
    claimType: "doenca_grave",
    description: "diagnostico de cancer aos 52 anos",
  });

  const exclusaoQuery = subQueries.find((q) => /exclus/i.test(q));
  const carenciaQuery = subQueries.find((q) => /car[eê]ncia/i.test(q));
  assert.ok(exclusaoQuery, "expected an exclusao-dimension sub-query");
  assert.ok(carenciaQuery, "expected a carencia-dimension sub-query");

  assert.equal(detectExhaustiveIntent(exclusaoQuery!).isExhaustive, true);
  assert.equal(detectExhaustiveIntent(carenciaQuery!).isExhaustive, true);
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
