import assert from "node:assert/strict";
import { resolveProviderChain } from "./llm-router";

let passed = 0, total = 0;
function check(name: string, fn: () => void) { total++; fn(); passed++; console.log("ok -", name); }

// Sonnet: OpenRouter -> Anthropic direto -> fail. NUNCA gemini-direct.
check("sonnet chain is openrouter then anthropic-direct", () => {
  assert.deepEqual(resolveProviderChain("anthropic/claude-sonnet-4.6"), ["openrouter", "anthropic-direct"]);
});
// Gemini (controle): OpenRouter -> Gemini direto. NUNCA anthropic-direct.
check("gemini chain is openrouter then gemini-direct", () => {
  assert.deepEqual(resolveProviderChain("google/gemini-2.5-flash"), ["openrouter", "gemini-direct"]);
});
// Fail-closed: nenhum provider mistura o outro endpoint.
check("no cross-provider leak", () => {
  assert.ok(!resolveProviderChain("anthropic/claude-sonnet-4.6").includes("gemini-direct"));
  assert.ok(!resolveProviderChain("google/gemini-2.5-flash").includes("anthropic-direct"));
});
// Modelo desconhecido: só OpenRouter, depois falha fechado.
check("unknown model is openrouter-only", () => {
  assert.deepEqual(resolveProviderChain("mistralai/mixtral"), ["openrouter"]);
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
