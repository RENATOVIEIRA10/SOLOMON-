/**
 * GET  /api/clients   — lista clientes do corretor autenticado
 * POST /api/clients   — cria cliente para o corretor autenticado
 *
 * Phase 5.2: a identidade do corretor vem da SESSÃO (auth_user_id), nunca de
 * um brokerId enviado pelo cliente. Sem sessão → 401.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireAuthUserId, getBrokerRowId } from "@/lib/auth";
import { PRODUCT_ANALYTICS_EVENTS, trackProductEvent } from "@/lib/product-analytics";

export async function GET() {
  try {
    const auth = await requireAuthUserId();
    if (auth instanceof NextResponse) return auth;
    const authUserId = auth;

    const rowId = await getBrokerRowId(authUserId);
    if (!rowId) return NextResponse.json({ clients: [] });

    const supabase = createServiceClient();
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
    const auth = await requireAuthUserId();
    if (auth instanceof NextResponse) return auth;
    const authUserId = auth;

    const body = (await request.json()) as {
      name: string;
      cpf?: string | null;
      phone?: string | null;
      email?: string | null;
      birth_date?: string | null;
      notes?: string | null;
    };

    if (!body.name || body.name.trim().length < 2) {
      return NextResponse.json(
        { error: "name (>=2 chars) is required" },
        { status: 400 }
      );
    }

    const rowId = await getBrokerRowId(authUserId);
    if (!rowId) {
      return NextResponse.json(
        { error: "broker not found — call /api/profile first" },
        { status: 404 }
      );
    }

    const supabase = createServiceClient();
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

    await trackProductEvent({
      eventName: PRODUCT_ANALYTICS_EVENTS.clientCreated,
      brokerId: rowId,
      authUserId,
      source: "api/clients",
      properties: {
        client_id: (data as { id: string }).id,
        has_cpf: Boolean(body.cpf),
        has_phone: Boolean(body.phone),
        has_email: Boolean(body.email),
        has_birth_date: Boolean(body.birth_date),
        has_notes: Boolean(body.notes),
      },
    });

    return NextResponse.json({ client: data });
  } catch (err) {
    console.error("[api/clients] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
