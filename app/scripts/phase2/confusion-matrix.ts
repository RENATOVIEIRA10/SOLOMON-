/**
 * Matriz de confusao custo-assimetrico do pre-sinistro (F0, Task 4).
 *
 * RISCO = abstencao ("nao da pra cravar"). O erro grave e o veredicto
 * CONCLUSIVO errado — especialmente afirmar COBERTO quando o gabarito do
 * corretor (Julio) diz NAO_COBERTO/RISCO: o corretor promete capital ao
 * cliente e a seguradora nega. Abster custa pouco; overclaiming custa caro.
 */

export type Verdict = "COBERTO" | "NAO_COBERTO" | "RISCO";

export interface ConfusionReport {
  matrix: Record<string, Record<string, number>>;
  falseConclusive: number;   // pred conclusivo (COBERTO/NAO_COBERTO) != gold
  coberto_sem_gold: number;  // pred COBERTO com gold != COBERTO (o pior)
  abstentionRate: number;    // fracao de pred=RISCO
  weightedCost: number;
}

// Custo assimetrico: afirmar COBERTO indevido e o mais caro; abster (RISCO) e barato.
const COST: Record<string, Record<string, number>> = {
  COBERTO:     { COBERTO: 0, NAO_COBERTO: 8, RISCO: 1 },
  NAO_COBERTO: { COBERTO: 10, NAO_COBERTO: 0, RISCO: 1 },
  RISCO:       { COBERTO: 10, NAO_COBERTO: 4, RISCO: 0 },
};

export function scoreConfusion(pairs: { gold: Verdict; pred: Verdict }[]): ConfusionReport {
  const v: Verdict[] = ["COBERTO", "NAO_COBERTO", "RISCO"];
  const matrix: Record<string, Record<string, number>> = {};
  for (const g of v) { matrix[g] = {}; for (const p of v) matrix[g][p] = 0; }
  let falseConclusive = 0, coberto_sem_gold = 0, abst = 0, cost = 0;
  for (const { gold, pred } of pairs) {
    matrix[gold][pred]++;
    cost += COST[gold][pred];
    if (pred === "RISCO") abst++;
    if (pred !== "RISCO" && pred !== gold) falseConclusive++;
    if (pred === "COBERTO" && gold !== "COBERTO") coberto_sem_gold++;
  }
  return {
    matrix,
    falseConclusive,
    coberto_sem_gold,
    abstentionRate: pairs.length ? abst / pairs.length : 0,
    weightedCost: cost,
  };
}

/** Render ASCII lado servivel pra log de VPS (linhas = gold, colunas = pred). */
export function formatConfusion(label: string, r: ConfusionReport): string {
  const v = ["COBERTO", "NAO_COBERTO", "RISCO"];
  const rows = v.map(
    (g) => `  ${g.padEnd(12)} | ${v.map((p) => String(r.matrix[g][p]).padStart(3)).join(" ")}`
  );
  return [
    `[${label}] gold \\ pred    | ${v.map((p) => p.slice(0, 3)).join(" ")}`,
    ...rows,
    `  falseConclusive=${r.falseConclusive} coberto_sem_gold=${r.coberto_sem_gold} abstention=${(r.abstentionRate * 100).toFixed(0)}% weightedCost=${r.weightedCost}`,
  ].join("\n");
}
