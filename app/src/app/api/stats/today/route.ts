/**
 * GET /api/stats/today?brokerId=<uuid>
 *
 * Contadores do dia para o corretor: consultas, plano, etc.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const PLAN_LIMITS: Record<string, number> = {
  trial: 10,
  corretor: 50,
  consultor: 9999,
  corretora: 9999,
};

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const brokerId = url.searchParams.get("brokerId");
    if (!brokerId) {
      return NextResponse.json(
        { error: "brokerId is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Count conversations today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [{ count: consultationsToday }, { data: broker }] = await Promise.all([
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("broker_id", brokerId)
        .gte("created_at", startOfDay.toISOString()),
      supabase
        .from("brokers")
        .select("plan, queries_today")
        .eq("auth_user_id", brokerId)
        .maybeSingle(),
    ]);

    const plan = (broker?.plan as string) ?? "trial";
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
