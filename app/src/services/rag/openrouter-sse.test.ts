/**
 * Standalone TDD harness for parseOpenRouterSSELine.
 *
 * SOLOMON has no test runner (no vitest/jest). Run manually with:
 *   cd app && npx tsx src/services/rag/openrouter-sse.test.ts
 * Exits 0 on success, 1 on first failed assertion. Never imported by app
 * routes, so it is not bundled — only type-checked by `next build`.
 */
import assert from "node:assert/strict";
import { parseOpenRouterSSELine, extractSSELines } from "./openrouter-sse";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

// 1. Delta with content
check("content delta -> {type:delta, text}", () => {
  const r = parseOpenRouterSSELine(
    'data: {"choices":[{"delta":{"content":"Olá"},"finish_reason":null}]}'
  );
  assert.equal(r.type, "delta");
  assert.equal(r.text, "Olá");
});

// 2. Terminator
check("[DONE] -> {type:done}", () => {
  const r = parseOpenRouterSSELine("data: [DONE]");
  assert.equal(r.type, "done");
});

// 3. OpenRouter keep-alive comment lines start with ':'
check("keep-alive comment -> {type:ignore}", () => {
  const r = parseOpenRouterSSELine(": OPENROUTER PROCESSING");
  assert.equal(r.type, "ignore");
});

// 4. Blank line between events
check("blank line -> {type:ignore}", () => {
  const r = parseOpenRouterSSELine("");
  assert.equal(r.type, "ignore");
});

// 5. Final chunk carries usage + finish_reason, empty delta
check("final usage chunk -> delta with usage+finishReason", () => {
  const r = parseOpenRouterSSELine(
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}'
  );
  assert.equal(r.type, "delta");
  assert.equal(r.text, "");
  assert.equal(r.finishReason, "stop");
  assert.deepEqual(r.usage, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  });
});

// 6. Malformed JSON must not throw — stream keeps going
check("malformed data -> {type:ignore} (no throw)", () => {
  const r = parseOpenRouterSSELine('data: {broken json');
  assert.equal(r.type, "ignore");
});

// --- extractSSELines: buffering across network chunks ---

// 7. Complete lines, nothing left over
check("complete lines -> all lines, empty rest", () => {
  const r = extractSSELines("data: a\ndata: b\n");
  assert.deepEqual(r.lines, ["data: a", "data: b"]);
  assert.equal(r.rest, "");
});

// 8. Trailing partial line is held back as rest (the core streaming bug)
check("partial trailing line -> held in rest", () => {
  const r = extractSSELines("data: a\ndata: {partia");
  assert.deepEqual(r.lines, ["data: a"]);
  assert.equal(r.rest, "data: {partia");
});

// 9. No newline yet -> everything is rest, no lines emitted
check("no newline -> nothing complete", () => {
  const r = extractSSELines("data: {incomp");
  assert.deepEqual(r.lines, []);
  assert.equal(r.rest, "data: {incomp");
});

// 10. Empty buffer
check("empty buffer -> empty", () => {
  const r = extractSSELines("");
  assert.deepEqual(r.lines, []);
  assert.equal(r.rest, "");
});

console.log(`\n${passed} passed`);
