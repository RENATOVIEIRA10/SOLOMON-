/**
 * Harness de correctness/A-B do pre-sinistro (F0, Task 4).
 *
 * Dois subcomandos:
 *
 *   predict — roda os casos do gabarito cego (Q46-Q65) pelo pipeline real:
 *     retrieval UMA vez por caso (retrievePreSinistroContext) e os DOIS
 *     modelos julgam o MESMO contexto via precomputedResults + modelOverride
 *     (Sonnet 4.6 = candidato; Gemini 2.5 Flash = controle). Persiste JSON
 *     por-caso incrementalmente. NAO precisa do gabarito preenchido — pode
 *     (e deve) rodar ANTES do Julio devolver, em modo cego.
 *
 *   score — cruza as predicoes persistidas com os veredictos do Julio no
 *     gabarito e imprime a matriz de confusao custo-assimetrico de cada
 *     braco lado a lado + casos divergentes. So produz numeros depois que
 *     o Julio preencher.
 *
 * Roda na VPS (precisa de DB + chaves LLM):
 *   cd /root/solomon/repo/app
 *   set -a && source .env.local && set +a
 *   npm run phase2:pre-sinistro-correctness -- predict
 *   npm run phase2:pre-sinistro-correctness -- score
 *
 * Flags: --limit N (smoke) · --only Q47,Q52 (re-rodar casos especificos)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

import { parseGabarito, type GabaritoEntry } from "./julio-gabarito-parser";
import { scoreConfusion, formatConfusion, type Verdict } from "./confusion-matrix";

const GABARITO_PATH =
  process.env.GABARITO_PATH ?? "eval/pre-sinistro/2026-07-15-gabarito-julio-cego.md";
const PREDICTIONS_PATH =
  process.env.PREDICTIONS_PATH ?? "eval/pre-sinistro/predictions-2026-07-15.json";

const SONNET_MODEL = "anthropic/claude-sonnet-4.6";
const CONTROL_MODEL = "google/gemini-2.5-flash";

/**
 * claimType canonico por caso. O gabarito MD nao carrega claimType (o Julio
 * decide pelo texto livre); o pipeline precisa dele pro fan-out de sub-queries.
 * Mapa estatico — o gabarito esta congelado (ja foi enviado ao Julio).
 */
const CLAIM_TYPE: Record<string, string> = {
  Q46: "doenca_grave",
  Q47: "morte_natural", // suicidio -> carencia de morte
  Q48: "morte_natural",
  Q49: "morte_natural", // DPS/ma-fe
  Q50: "morte_acidental",
  Q51: "morte_natural",
  Q52: "morte_natural", // suicidio 30 meses
  Q53: "doenca_grave",
  Q54: "doenca_grave",
  Q55: "morte_acidental",
  Q56: "invalidez",
  Q57: "invalidez",
  Q58: "morte_acidental",
  Q59: "morte_acidental",
  Q60: "morte_natural",
  Q61: "morte_natural",
  Q62: "diaria",
  Q63: "doenca_grave",
  Q64: "morte_natural",
  Q65: "morte_natural",
};

interface ArmPrediction {
  model: string;
  verdict: Verdict | null;
  confidence: number | null;
  rationale: string | null;
  riskFlags: string[];
  validatedClaims: number;
  totalClaims: number;
  latencyMs: number | null;
  error: string | null;
}

interface CasePrediction {
  id: string;
  insurer: string;
  product: string;
  claimType: string;
  facts: string;
  retrieval: { chunkCount: number; avgSimilarity: number };
  sonnet: ArmPrediction;
  control: ArmPrediction;
}

function loadPredictions(): CasePrediction[] {
  if (!existsSync(PREDICTIONS_PATH)) return [];
  return JSON.parse(readFileSync(PREDICTIONS_PATH, "utf8")) as CasePrediction[];
}

function savePredictions(preds: CasePrediction[]) {
  writeFileSync(PREDICTIONS_PATH, JSON.stringify(preds, null, 2) + "\n", "utf8");
}

function parseArgs(argv: string[]) {
  const cmd = argv[0];
  let limit = Infinity;
  let only: Set<string> | null = null;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--limit") limit = Number(argv[++i]);
    if (argv[i] === "--only") only = new Set(argv[++i].split(",").map((s) => s.trim()));
  }
  return { cmd, limit, only };
}

async function predict(limit: number, only: Set<string> | null) {
  // Imports dinamicos: puxam a cadeia src/ (supabase client etc), que exige
  // env carregado — só o subcomando predict paga esse custo; score é offline.
  const { analyzePreSinistro, retrievePreSinistroContext } = await import(
    "../../src/services/rag/pre-sinistro"
  );

  const entries = parseGabarito(readFileSync(GABARITO_PATH, "utf8"));
  const preds = loadPredictions();
  const done = new Set(preds.map((p) => p.id));

  let ran = 0;
  for (const entry of entries) {
    if (ran >= limit) break;
    if (only && !only.has(entry.id)) continue;
    if (!only && done.has(entry.id)) {
      console.log(`[skip] ${entry.id} ja tem predicao (use --only ${entry.id} pra re-rodar)`);
      continue;
    }
    const claimType = CLAIM_TYPE[entry.id];
    if (!claimType) {
      console.warn(`[warn] ${entry.id} sem claimType mapeado — pulando`);
      continue;
    }
    if (!entry.facts) {
      console.warn(`[warn] ${entry.id} sem linha **Fatos:** — pulando`);
      continue;
    }
    ran++;

    // Produto vai na descricao (nao em productHint): productHint filtra por
    // metadata.product_name exato e devolveria RISCO artificial quando o
    // nome comercial do gabarito nao casa com o metadata da ingestao.
    const description = `${entry.facts} (Produto: ${entry.product})`;
    const base = { insurerName: entry.insurer, claimType, description };

    console.log(`\n[${entry.id}] ${entry.insurer} · ${entry.product} (${claimType})`);
    let results;
    try {
      results = await retrievePreSinistroContext(base);
    } catch (e) {
      console.error(`[${entry.id}] retrieval FALHOU: ${(e as Error).message}`);
      continue;
    }
    const avgSim = results.length
      ? results.reduce((a, r) => a + (r.similarity ?? 0), 0) / results.length
      : 0;
    console.log(`  retrieval: ${results.length} chunks, avgSim=${avgSim.toFixed(2)}`);

    const runArm = async (model: string): Promise<ArmPrediction> => {
      try {
        const r = await analyzePreSinistro({
          ...base,
          precomputedResults: results,
          modelOverride: model,
        });
        return {
          model: r.model,
          verdict: r.verdict,
          confidence: r.confidence,
          rationale: r.rationale,
          riskFlags: r.riskFlags,
          validatedClaims: r.claimEvidence.filter((c) => c.validated).length,
          totalClaims: r.claimEvidence.length,
          latencyMs: r.latencyMs,
          error: null,
        };
      } catch (e) {
        return {
          model,
          verdict: null,
          confidence: null,
          rationale: null,
          riskFlags: [],
          validatedClaims: 0,
          totalClaims: 0,
          latencyMs: null,
          error: (e as Error).message,
        };
      }
    };

    // Sequencial de proposito (rate limits); os dois bracos veem os MESMOS chunks.
    const sonnet = await runArm(SONNET_MODEL);
    console.log(`  sonnet : ${sonnet.verdict ?? `ERRO ${sonnet.error}`} (conf=${sonnet.confidence ?? "-"})`);
    const control = await runArm(CONTROL_MODEL);
    console.log(`  control: ${control.verdict ?? `ERRO ${control.error}`} (conf=${control.confidence ?? "-"})`);

    const record: CasePrediction = {
      id: entry.id,
      insurer: entry.insurer,
      product: entry.product,
      claimType,
      facts: entry.facts,
      retrieval: { chunkCount: results.length, avgSimilarity: avgSim },
      sonnet,
      control,
    };
    const idx = preds.findIndex((p) => p.id === entry.id);
    if (idx >= 0) preds[idx] = record;
    else preds.push(record);
    savePredictions(preds); // incremental: crash nao perde casos ja rodados
  }
  console.log(`\n${preds.length} predicoes em ${PREDICTIONS_PATH}`);
}

function score() {
  const entries = parseGabarito(readFileSync(GABARITO_PATH, "utf8"));
  const preds = loadPredictions();
  const byId = new Map(preds.map((p) => [p.id, p]));

  const gold = entries.filter((e): e is GabaritoEntry & { verdict: Verdict } => e.verdict !== null);
  if (gold.length === 0) {
    console.log(
      `Gabarito ainda sem veredictos do Julio (0/${entries.length} preenchidos em ${GABARITO_PATH}).\n` +
        `O predict pode rodar mesmo assim; o score espera o Julio.`
    );
    process.exit(2);
  }
  console.log(`Gabarito: ${gold.length}/${entries.length} casos com veredicto do Julio.\n`);

  const pairs = (arm: "sonnet" | "control") =>
    gold
      .filter((e) => byId.get(e.id)?.[arm]?.verdict)
      .map((e) => ({ gold: e.verdict, pred: byId.get(e.id)![arm].verdict as Verdict }));

  const missing = gold.filter((e) => !byId.get(e.id)).map((e) => e.id);
  if (missing.length) {
    console.log(`[aviso] ${missing.length} casos com gold mas SEM predicao: ${missing.join(", ")} — rode predict.\n`);
  }

  console.log(formatConfusion(`sonnet ${SONNET_MODEL}`, scoreConfusion(pairs("sonnet"))));
  console.log();
  console.log(formatConfusion(`control ${CONTROL_MODEL}`, scoreConfusion(pairs("control"))));

  console.log("\nCasos divergentes (gold vs bracos):");
  for (const e of gold) {
    const p = byId.get(e.id);
    if (!p) continue;
    const s = p.sonnet.verdict ?? "ERRO";
    const c = p.control.verdict ?? "ERRO";
    if (s !== e.verdict || c !== e.verdict) {
      console.log(
        `  ${e.id} gold=${e.verdict} sonnet=${s} control=${c}` +
          ` | julio: ${e.decisiveClause ?? "-"} (conf ${e.confidence ?? "-"})`
      );
    }
  }
}

async function main() {
  const { cmd, limit, only } = parseArgs(process.argv.slice(2));
  if (cmd === "predict") await predict(limit, only);
  else if (cmd === "score") score();
  else {
    console.log("uso: pre-sinistro-correctness.ts <predict|score> [--limit N] [--only Q47,Q52]");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
