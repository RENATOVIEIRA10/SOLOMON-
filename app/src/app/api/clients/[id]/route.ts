/**
 * PUT    /api/clients/[id]  — update
 * DELETE /api/clients/[id]  — delete
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
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
      .select("*")
      .single();

    if (error) {
      console.error("[api/clients/:id] update failed:", error.message);
      return NextResponse.json({ error: "update failed" }, { status: 500 });
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
    const { id } = await context.params;
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("broker_clients")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[api/clients/:id] delete failed:", error.message);
      return NextResponse.json({ error: "delete failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/clients/:id] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
