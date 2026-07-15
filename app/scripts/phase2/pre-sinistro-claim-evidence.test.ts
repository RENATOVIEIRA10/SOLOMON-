/**
 * F1: evidencia por claim — validateClaimEvidence() unit test.
 *
 * Cobre a validacao pura de claims atomicos: claim de apolice so e
 * validado se todos os chunkIds citados existem no contexto (1..chunkCount);
 * claim juridico (lei/CC/SUSEP) fica sempre nao-validado ate o corpus
 * juridico da F2. Zero I/O (sem DB, sem embed, sem LLM) — deterministico.
 *
 * Run from app/:
 *   npx tsx scripts/phase2/pre-sinistro-claim-evidence.test.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import assert from "node:assert/strict";
import { validateClaimEvidence } from "../../src/services/rag/pre-sinistro";

let passed = 0,
  total = 0;
function check(name: string, fn: () => void) {
  total++;
  fn();
  passed++;
  console.log("ok -", name);
}

check("apolice claim with valid chunkIds is validated", () => {
  const out = validateClaimEvidence(
    [{ claim: "carencia 2 anos", type: "apolice", chunkIds: [1, 3] }],
    8
  );
  assert.equal(out[0].validated, true);
});

check("apolice claim citing out-of-range chunk is not validated", () => {
  const out = validateClaimEvidence(
    [{ claim: "x", type: "apolice", chunkIds: [99] }],
    8
  );
  assert.equal(out[0].validated, false);
});

check("apolice claim with no chunkIds is not validated", () => {
  const out = validateClaimEvidence(
    [{ claim: "sem evidencia", type: "apolice", chunkIds: [] }],
    8
  );
  assert.equal(out[0].validated, false);
});

check("juridico claim is always non-validated until F2 corpus", () => {
  const out = validateClaimEvidence(
    [{ claim: "Art. 766 CC", type: "juridico", chunkIds: [] }],
    8
  );
  assert.equal(out[0].validated, false);
});

check("juridico claim with VALID in-range chunkIds is still non-validated (proves type guard is load-bearing)", () => {
  const out = validateClaimEvidence(
    [{ claim: "Art. 766 CC", type: "juridico", chunkIds: [1] }],
    8
  );
  assert.equal(out[0].validated, false);
});

check("apolice claim with non-integer chunkId (1.5) is not validated", () => {
  const out = validateClaimEvidence(
    [{ claim: "carencia fracionada", type: "apolice", chunkIds: [1.5] }],
    8
  );
  assert.equal(out[0].validated, false);
});

check("malformed claim (chunkIds missing) does not throw and is not validated", () => {
  const out = validateClaimEvidence(
    [{ claim: "sem chunkIds no campo", type: "apolice" }],
    8
  );
  assert.equal(out[0].validated, false);
  assert.deepEqual(out[0].chunkIds, []);
});

check("malformed claim (chunkIds as string, not array) does not throw and is not validated", () => {
  const out = validateClaimEvidence(
    [{ claim: "chunkIds string", type: "apolice", chunkIds: "1,3" }],
    8
  );
  assert.equal(out[0].validated, false);
  assert.deepEqual(out[0].chunkIds, []);
});

check("malformed claim item (null in array) does not throw and is not validated", () => {
  const out = validateClaimEvidence([null], 8);
  assert.equal(out[0].validated, false);
  assert.equal(out[0].claim, "");
  assert.equal(out[0].type, "apolice");
});

check("claim with NO type field but valid in-range chunkIds is not validated (fail-closed default)", () => {
  const out = validateClaimEvidence(
    [{ claim: "x", chunkIds: [1] }],
    8
  );
  assert.equal(out[0].validated, false);
});

check("preserves claim/type/chunkIds fields on output", () => {
  const out = validateClaimEvidence(
    [{ claim: "carencia 2 anos", type: "apolice", chunkIds: [2] }],
    5
  );
  assert.equal(out[0].claim, "carencia 2 anos");
  assert.equal(out[0].type, "apolice");
  assert.deepEqual(out[0].chunkIds, [2]);
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
