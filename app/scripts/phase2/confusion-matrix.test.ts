import assert from "node:assert/strict";
import { scoreConfusion } from "./confusion-matrix";

let passed = 0, total = 0;
function check(name: string, fn: () => void) { total++; fn(); passed++; console.log("ok -", name); }

// RISCO = abstencao. O pecado grave: veredicto CONCLUSIVO errado (gold RISCO/NAO -> pred COBERTO).
check("false conclusive counts COBERTO when gold is not COBERTO", () => {
  const r = scoreConfusion([
    { gold: "COBERTO", pred: "COBERTO" },       // ok
    { gold: "NAO_COBERTO", pred: "COBERTO" },   // FALSO CONCLUSIVO (pior)
    { gold: "COBERTO", pred: "RISCO" },         // abstencao (custo baixo)
  ]);
  assert.equal(r.falseConclusive, 1);
  assert.equal(r.coberto_sem_gold, 1);
  assert.ok(r.abstentionRate > 0);
});

check("weighted cost penalizes false-conclusive heaviest", () => {
  const abst = scoreConfusion([{ gold: "COBERTO", pred: "RISCO" }]).weightedCost;
  const falseConc = scoreConfusion([{ gold: "NAO_COBERTO", pred: "COBERTO" }]).weightedCost;
  assert.ok(falseConc > abst);
});

check("NAO_COBERTO when gold is RISCO is conclusive error but cheaper than COBERTO", () => {
  const naoCob = scoreConfusion([{ gold: "RISCO", pred: "NAO_COBERTO" }]);
  const cob = scoreConfusion([{ gold: "RISCO", pred: "COBERTO" }]);
  assert.equal(naoCob.falseConclusive, 1);
  assert.equal(cob.coberto_sem_gold, 1);
  assert.ok(cob.weightedCost > naoCob.weightedCost);
});

check("perfect predictions cost zero", () => {
  const r = scoreConfusion([
    { gold: "COBERTO", pred: "COBERTO" },
    { gold: "NAO_COBERTO", pred: "NAO_COBERTO" },
    { gold: "RISCO", pred: "RISCO" },
  ]);
  assert.equal(r.weightedCost, 0);
  assert.equal(r.falseConclusive, 0);
  assert.equal(r.matrix.COBERTO.COBERTO, 1);
  assert.equal(r.matrix.RISCO.RISCO, 1);
});

check("empty input does not divide by zero", () => {
  const r = scoreConfusion([]);
  assert.equal(r.abstentionRate, 0);
  assert.equal(r.weightedCost, 0);
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
