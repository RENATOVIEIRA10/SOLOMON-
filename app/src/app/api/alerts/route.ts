/**
 * GET /api/alerts?brokerId=<uuid>&unreadOnly=true&limit=10
 *
 * Lista alertas (globais com broker_id null + do broker especifico).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireAuthUserId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthUserId();
    if (auth instanceof NextResponse) return auth;
    const brokerId = auth; // session-derived (auth_user_id)

    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);

    const supabase = createServiceClient();
    let query = supabase
      .from("alerts")
      .select("id, type, title, message, source_url, read, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (brokerId) {
      query = query.or(`broker_id.is.null,broker_id.eq.${brokerId}`);
    } else {
      query = query.is("broker_id", null);
    }

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
