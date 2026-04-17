/**
 * GET /api/knowledge/search?q=<query>&insurer=<name>&limit=10
 *
 * Busca semantica nas condicoes gerais indexadas. Retorna chunks crus
 * (sem interpretacao LLM) — util para corretor que quer o texto exato.
 */

import { NextRequest, NextResponse } from "next/server";
import { semanticSearch } from "@/services/rag/search";
import { loadEnrichment, resolveInsurerIds } from "@/services/rag/answer";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const insurerName = url.searchParams.get("insurer");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 10) || 10, 30);

    if (q.length < 3) {
      return NextResponse.json({ results: [] });
    }

    let insurerId: string | undefined;
    if (insurerName) {
      const map = await resolveInsurerIds([insurerName]);
      insurerId = map.values().next().value?.[0];
    }

    const results = await semanticSearch(q, { insurerId, topK: limit });
    const enrichment = await loadEnrichment(results);

    const enriched = results.map((r) => ({
      id: r.id,
      content: r.content,
      similarity: r.similarity ?? 0,
      source_url: r.source_url ?? null,
      insurer:
        enrichment.insurers.get(r.insurer_id ?? "") ?? "—",
      product:
        enrichment.products.get(r.product_id ?? "")?.name ?? null,
      susep_process:
        enrichment.products.get(r.product_id ?? "")?.susep_process ?? null,
    }));

    return NextResponse.json({ results: enriched });
  } catch (err) {
    console.error("[api/knowledge/search] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
