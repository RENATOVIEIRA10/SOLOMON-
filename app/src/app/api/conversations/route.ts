/**
 * GET /api/conversations
 *
 * Lista histórico de conversas do corretor (últimas 30).
 * Query params: ?limit=30
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireBrokerContext } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const broker = await requireBrokerContext();
    if (broker instanceof NextResponse) return broker;

    const url = new URL(request.url);
    const limit = Math.min(
      Number(url.searchParams.get("limit") ?? 30) || 30,
      100
    );

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, message, response, sources, model, latency_ms, created_at")
      .eq("broker_id", broker.brokerId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[api/conversations] query failed:", error.message);
      return NextResponse.json(
        { error: "Failed to load conversations" },
        { status: 500 }
      );
    }

    return NextResponse.json({ conversations: data ?? [] });
  } catch (err) {
    console.error("[api/conversations] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
