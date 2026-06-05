/**
 * GET /api/stats/today
 *
 * Contadores do dia para o corretor: consultas, plano, etc.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireBrokerContext } from "@/lib/auth";

const PLAN_LIMITS: Record<string, number> = {
  free: 5,
  corretor: 50,
  consultor: 9999,
  corretora: 9999,
};

export async function GET() {
  try {
    const context = await requireBrokerContext();
    if (context instanceof NextResponse) return context;

    const supabase = createServiceClient();

    // Count conversations today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [{ count: consultationsToday }, { data: broker }] = await Promise.all([
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("broker_id", context.brokerId)
        .gte("created_at", startOfDay.toISOString()),
      supabase
        .from("brokers")
        .select("plan, queries_today")
        .eq("id", context.brokerId)
        .maybeSingle(),
    ]);

    const plan = (broker?.plan as string) ?? "free";
    const limit = PLAN_LIMITS[plan] ?? 10;

    return NextResponse.json({
      consultationsToday: consultationsToday ?? 0,
      plan,
      limit,
    });
  } catch (err) {
    console.error("[api/stats/today] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
