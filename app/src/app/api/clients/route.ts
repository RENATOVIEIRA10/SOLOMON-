/**
 * GET  /api/clients?brokerId=<uuid>  — lista clientes do corretor
 * POST /api/clients                   — cria cliente
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

async function resolveBrokerRowId(
  supabase: ReturnType<typeof createServiceClient>,
  authUserId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("brokers")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

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
    const rowId = await resolveBrokerRowId(supabase, brokerId);
    if (!rowId) return NextResponse.json({ clients: [] });

    const { data, error } = await supabase
      .from("broker_clients")
      .select("*")
      .eq("broker_id", rowId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[api/clients] list failed:", error.message);
      return NextResponse.json({ error: "fetch failed" }, { status: 500 });
    }

    return NextResponse.json({ clients: data ?? [] });
  } catch (err) {
    console.error("[api/clients] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      brokerId: string;
      name: string;
      cpf?: string | null;
      phone?: string | null;
      email?: string | null;
      birth_date?: string | null;
      notes?: string | null;
    };

    if (!body.brokerId || !body.name || body.name.trim().length < 2) {
      return NextResponse.json(
        { error: "brokerId and name (>=2 chars) are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const rowId = await resolveBrokerRowId(supabase, body.brokerId);
    if (!rowId) {
      return NextResponse.json(
        { error: "broker not found — call /api/profile first" },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from("broker_clients")
      .insert({
        broker_id: rowId,
        name: body.name.trim(),
        cpf: body.cpf ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        birth_date: body.birth_date ?? null,
        notes: body.notes ?? null,
      } as never)
      .select("*")
      .single();

    if (error) {
      console.error("[api/clients] insert failed:", error.message);
      return NextResponse.json({ error: "insert failed" }, { status: 500 });
    }

    return NextResponse.json({ client: data });
  } catch (err) {
    console.error("[api/clients] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
