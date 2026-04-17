/**
 * POST /api/pre-sinistro
 *
 * Analisa evento contra condicoes gerais da seguradora ANTES de abrir sinistro.
 * Body: { insurerName, claimType, description, brokerId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { analyzePreSinistro } from "@/services/rag/pre-sinistro";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      insurerName: string;
      claimType: string;
      description: string;
      brokerId?: string;
    };

    if (!body.insurerName || !body.claimType || !body.description) {
      return NextResponse.json(
        { error: "insurerName, claimType e description sao obrigatorios" },
        { status: 400 }
      );
    }

    if (body.description.trim().length < 10) {
      return NextResponse.json(
        { error: "description precisa de pelo menos 10 caracteres" },
        { status: 400 }
      );
    }

    const result = await analyzePreSinistro({
      insurerName: body.insurerName,
      claimType: body.claimType,
      description: body.description.trim(),
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/pre-sinistro] error:", err);
    const message = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
