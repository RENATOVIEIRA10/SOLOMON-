/**
 * GET /api/profile  — fetch (bootstrap mínimo na 1ª vez) do corretor autenticado
 * PUT /api/profile  — update do corretor autenticado
 *
 * Phase 5.2: a identidade (auth_user_id) vem da SESSÃO, nunca de um brokerId
 * do cliente. Sem sessão → 401. O bootstrap só cria o registro do PRÓPRIO
 * usuário autenticado (allowlist via PILOT_BROKER_ALLOWLIST em @/lib/auth).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireAuthUserId } from "@/lib/auth";

const DEFAULT_PLAN = "trial";

export async function GET() {
  try {
    const auth = await requireAuthUserId();
    if (auth instanceof NextResponse) return auth;
    const authUserId = auth;

    const supabase = createServiceClient();

    const { data: existing, error: findErr } = await supabase
      .from("brokers")
      .select("*")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (findErr) {
      console.error("[api/profile] find failed:", findErr.message);
      return NextResponse.json({ error: "fetch failed" }, { status: 500 });
    }

    if (existing) {
      return NextResponse.json({ profile: existing });
    }

    // Bootstrap: cria registro minimo para o usuario autenticado (não para um
    // id arbitrário do cliente, como antes).
    const { data: created, error: insertErr } = await supabase
      .from("brokers")
      .insert({
        auth_user_id: authUserId,
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
      return NextResponse.json({ error: "bootstrap failed" }, { status: 500 });
    }

    return NextResponse.json({ profile: created });
  } catch (err) {
    console.error("[api/profile] error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuthUserId();
    if (auth instanceof NextResponse) return auth;
    const authUserId = auth;

    const body = (await request.json()) as {
      name?: string;
      phone?: string;
      email?: string | null;
      cpf?: string | null;
      creci?: string | null;
      susep_number?: string | null;
    };

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
      .eq("auth_user_id", authUserId)
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
