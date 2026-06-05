/**
 * POST /api/compare
 *
 * Body: { insurerNames: string[], productType: string }
 * Retorna comparativo estruturado entre 2-3 seguradoras.
 */

import { NextRequest, NextResponse } from "next/server";
import { compareInsurers } from "@/services/rag/compare";
import {
  aiQuotaHeaders,
  enforceAiQuota,
  incrementAiQuota,
  isAiAccessResponse,
  requireAiAccess,
} from "@/lib/ai-access";
import {
  PRODUCT_ANALYTICS_EVENTS,
  quotaRemaining,
  trackProductEvent,
} from "@/lib/product-analytics";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  try {
    const aiAccess = await requireAiAccess(request);
    if (isAiAccessResponse(aiAccess)) return aiAccess;
    if (!aiAccess) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const quotaBlocked = enforceAiQuota(aiAccess);
    if (quotaBlocked) {
      await trackProductEvent({
        eventName: PRODUCT_ANALYTICS_EVENTS.quotaExceeded,
        brokerId: aiAccess.brokerId,
        authUserId: aiAccess.authUserId,
        source: "api/compare",
        properties: {
          plan: aiAccess.plan,
          queries_today: aiAccess.queriesToday,
          queries_per_day: aiAccess.queriesPerDay,
        },
      });
      return quotaBlocked;
    }

    const body = (await request.json()) as {
      insurerNames: string[];
      productType: string;
    };

    if (!Array.isArray(body.insurerNames) || body.insurerNames.length < 2) {
      return NextResponse.json(
        { error: "insurerNames deve ter 2 ou 3 itens" },
        { status: 400 }
      );
    }
    if (!body.productType || typeof body.productType !== "string") {
      return NextResponse.json(
        { error: "productType e obrigatorio" },
        { status: 400 }
      );
    }

    const startedAt = Date.now();
    await trackProductEvent({
      eventName: PRODUCT_ANALYTICS_EVENTS.comparisonStarted,
      brokerId: aiAccess.brokerId,
      authUserId: aiAccess.authUserId,
      source: "api/compare",
      properties: {
        plan: aiAccess.plan,
        product_type: body.productType,
        insurers_count: body.insurerNames.length,
        insurer_names: body.insurerNames,
        quota_remaining_before: quotaRemaining(aiAccess.queriesToday, aiAccess.queriesPerDay),
      },
    });

    const result = await compareInsurers({
      insurerNames: body.insurerNames,
      productType: body.productType,
    });

    await incrementAiQuota(aiAccess);
    await trackProductEvent({
      eventName: PRODUCT_ANALYTICS_EVENTS.comparisonCompleted,
      brokerId: aiAccess.brokerId,
      authUserId: aiAccess.authUserId,
      source: "api/compare",
      properties: {
        plan: aiAccess.plan,
        product_type: body.productType,
        insurers_count: body.insurerNames.length,
        wall_latency_ms: Date.now() - startedAt,
        quota_remaining_after: quotaRemaining(aiAccess.queriesToday + 1, aiAccess.queriesPerDay),
      },
    });
    return NextResponse.json(result, {
      headers: aiQuotaHeaders({ ...aiAccess, queriesToday: aiAccess.queriesToday + 1 }),
    });
  } catch (err) {
    console.error("[api/compare] error:", err);
    const message = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
