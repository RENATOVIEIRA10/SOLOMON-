/**
 * GET /api/profile?brokerId=<uuid>  — upsert + fetch
 * PUT /api/profile                  — update
 *
 * Enquanto auth Supabase nao esta ativo, usamos o UUID do localStorage como
 * auth_user_id bootstrap. Ao entrar em auth real, o bootstrap vira no-op.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const DEFAULT_PLAN = "trial";

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

    // Try find by auth_user_id
    const { data: existing, error: findErr } = await supabase
      .from("brokers")
      .select("*")
      .eq("auth_user_id", brokerId)
      .maybeSingle();

    if (findErr) {
      console.error("[api/profile] find failed:", findErr.message);
      return NextResponse.json({ error: "fetch failed" }, { status: 500 });
    }

    if (existing) {
      return NextResponse.json({ profile: existing });
    }

    // Bootstrap: cria registro minimo
    const { data: created, error: insertErr } = await supabase
      .from("brokers")
      .insert({
        auth_user_id: brokerId,
        name: "Corretor",
        phone: "",
        plan: DEFAULT_PLAN,
        queries_today: 0,
        active: true,
      } as never)
      .select("*")
      .single();

    if (insertErr) {
      console.error("[api/profile] insert failed:", insertErr.message);
      return NextResponse.json(
        { error: "bootstrap failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ profile: created });
  } catch (err) {
    console.error("[api/profile] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      brokerId: string;
      name?: string;
      phone?: string;
      email?: string | null;
      cpf?: string | null;
      creci?: string | null;
      susep_number?: string | null;
    };
    if (!body.brokerId) {
      return NextResponse.json(
        { error: "brokerId is required" },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.email !== undefined) patch.email = body.email;
    if (body.cpf !== undefined) patch.cpf = body.cpf;
    if (body.creci !== undefined) patch.creci = body.creci;
    if (body.susep_number !== undefined) patch.susep_number = body.susep_number;

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("brokers")
      .update(patch as never)
      .eq("auth_user_id", body.brokerId)
      .select("*")
      .single();

    if (error) {
      console.error("[api/profile] update failed:", error.message);
      return NextResponse.json({ error: "update failed" }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (err) {
    console.error("[api/profile] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
