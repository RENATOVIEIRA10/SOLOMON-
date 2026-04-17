/**
 * POST /api/compare
 *
 * Body: { insurerNames: string[], productType: string }
 * Retorna comparativo estruturado entre 2-3 seguradoras.
 */

import { NextRequest, NextResponse } from "next/server";
import { compareInsurers } from "@/services/rag/compare";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      insurerNames: string[];
      productType: string;
    };

    if (!Array.isArray(body.insurerNames) || body.insurerNames.length < 2) {
      return NextResponse.json(
        { error: "insurerNames deve ter 2 ou 3 itens" },
        { status: 400 }
      );
    }
    if (!body.productType || typeof body.productType !== "string") {
      return NextResponse.json(
        { error: "productType e obrigatorio" },
        { status: 400 }
      );
    }

    const result = await compareInsurers({
      insurerNames: body.insurerNames,
      productType: body.productType,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/compare] error:", err);
    const message = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
