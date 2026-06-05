/**
 * GET /api/alerts?unreadOnly=true&limit=10
 *
 * Lista alertas (globais com broker_id null + do broker especifico).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireBrokerContext } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const broker = await requireBrokerContext();
    if (broker instanceof NextResponse) return broker;

    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);

    const supabase = createServiceClient();
    let query = supabase
      .from("alerts")
      .select("id, type, title, message, source_url, read, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    query = query.or(`broker_id.is.null,broker_id.eq.${broker.brokerId}`);

    if (unreadOnly) {
      query = query.eq("read", false);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[api/alerts] query failed:", error.message);
      return NextResponse.json({ error: "fetch failed" }, { status: 500 });
    }

    return NextResponse.json({ alerts: data ?? [] });
  } catch (err) {
    console.error("[api/alerts] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
