/**
 * GET /api/insurers
 *
 * Lista seguradoras ativas para o filtro do chat.
 * Response: { insurers: Array<{ id, name, logo_url }> }
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("insurers")
      .select("id, name, logo_url")
      .eq("active", true)
      .order("name");

    if (error) {
      console.error("[api/insurers] query failed:", error.message);
      return NextResponse.json(
        { error: "Failed to load insurers" },
        { status: 500 }
      );
    }

    return NextResponse.json({ insurers: data ?? [] });
  } catch (err) {
    console.error("[api/insurers] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
