import assert from "node:assert/strict";
import { excerptFoundInChunks } from "../../src/services/rag/pre-sinistro";
import type { SearchResult } from "../../src/services/rag/search";

let passed = 0, total = 0;
function check(name: string, fn: () => void) { total++; fn(); passed++; console.log("ok -", name); }

const chunk = (content: string): SearchResult =>
  ({ id: "c1", content, similarity: 0.8, source_url: null, insurer_id: "x", metadata: {} } as unknown as SearchResult);

// Chunks de PDF tem quebras de linha e espacos duplos no meio das clausulas.
// O excerpt do LLM vem com espacos simples — o match nao pode morrer nisso.
check("excerpt matches across line breaks in chunk (bug 19/20 citacoes removidas)", () => {
  const c = chunk(
    "Clausula 4.2 — Carencia:\no periodo de   sobrevivencia de 30 dias\ncontados do diagnostico e exigido para Doencas Graves."
  );
  assert.ok(
    excerptFoundInChunks(
      "o periodo de sobrevivencia de 30 dias contados do diagnostico",
      [c]
    )
  );
});

check("excerpt with accents matches unaccented chunk and vice-versa", () => {
  const c = chunk("O período de\ncarência para suicídio é de 2 (dois) anos da contratação.");
  assert.ok(
    excerptFoundInChunks("o periodo de carencia para suicidio e de 2 (dois) anos", [c])
  );
});

check("excerpt genuinely absent from chunks is still rejected (guardrail integro)", () => {
  const c = chunk("Texto qualquer da condicao geral sem relacao alguma com o trecho citado.");
  assert.equal(
    excerptFoundInChunks("esta frase inventada pelo modelo nao existe em nenhum chunk indexado", [c]),
    false
  );
});

check("short excerpt (<30 chars) still matches with whitespace noise", () => {
  const c = chunk("carencia de\n  suicidio: 2 anos");
  assert.ok(excerptFoundInChunks("carencia de suicidio", [c]));
});

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
