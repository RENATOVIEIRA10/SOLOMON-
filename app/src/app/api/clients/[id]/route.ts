/**
 * PUT    /api/clients/[id]  — update (somente cliente do corretor autenticado)
 * DELETE /api/clients/[id]  — delete (somente cliente do corretor autenticado)
 *
 * Phase 5.2: ownership enforced — a operação é escopada por `broker_id` do
 * corretor da SESSÃO. Tentar mexer no cliente de outro corretor afeta 0 linhas
 * → 404. Antes não havia checagem de dono (IDOR).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireAuthUserId, getBrokerRowId } from "@/lib/auth";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthUserId();
    if (auth instanceof NextResponse) return auth;
    const rowId = await getBrokerRowId(auth);
    if (!rowId) return NextResponse.json({ error: "broker not found" }, { status: 404 });

    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      cpf?: string | null;
      phone?: string | null;
      email?: string | null;
      birth_date?: string | null;
      notes?: string | null;
    };

    const patch: Record<string, unknown> = {};
    for (const k of ["name", "cpf", "phone", "email", "birth_date", "notes"] as const) {
      if (body[k] !== undefined) patch[k] = body[k];
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("broker_clients")
      .update(patch as never)
      .eq("id", id)
      .eq("broker_id", rowId)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[api/clients/:id] update failed:", error.message);
      return NextResponse.json({ error: "update failed" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ client: data });
  } catch (err) {
    console.error("[api/clients/:id] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuthUserId();
    if (auth instanceof NextResponse) return auth;
    const rowId = await getBrokerRowId(auth);
    if (!rowId) return NextResponse.json({ error: "broker not found" }, { status: 404 });

    const { id } = await context.params;
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("broker_clients")
      .delete()
      .eq("id", id)
      .eq("broker_id", rowId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[api/clients/:id] delete failed:", error.message);
      return NextResponse.json({ error: "delete failed" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/clients/:id] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
