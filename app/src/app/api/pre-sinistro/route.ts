/**
 * POST /api/pre-sinistro
 *
 * Analisa evento contra condicoes gerais da seguradora ANTES de abrir sinistro.
 * Body: { insurerName, claimType, description, brokerId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { analyzePreSinistro } from "@/services/rag/pre-sinistro";
import { getBrokerRowId, requireAuthUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // Broker-facing, high-consequence route — requires a verified session.
    const auth = await requireAuthUserId();
    if (auth instanceof NextResponse) return auth;
    const brokerRowId = await getBrokerRowId(auth);
    if (!brokerRowId) {
      return NextResponse.json(
        { error: "broker not found — call /api/profile first" },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      insurerName: string;
      claimType: string;
      description: string;
      productHint?: string;
      brokerClientId?: string;
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
    if (body.description.length > 4000) {
      return NextResponse.json(
        { error: "description deve ter no maximo 4000 caracteres" },
        { status: 400 }
      );
    }
    if (body.insurerName.length > 120 || body.claimType.length > 120 || (body.productHint?.length ?? 0) > 160) {
      return NextResponse.json(
        { error: "campos de identificacao excedem o tamanho maximo" },
        { status: 400 }
      );
    }

    if (body.brokerClientId) {
      const ownsClient = await brokerOwnsClient(brokerRowId, body.brokerClientId);
      if (!ownsClient) {
        return NextResponse.json({ error: "client not found" }, { status: 404 });
      }
    }

    const result = await analyzePreSinistro({
      insurerName: body.insurerName,
      claimType: body.claimType,
      description: body.description.trim(),
      productHint: body.productHint?.trim() || undefined,
    });

    const analysisId = await saveClaimAnalysis({
      brokerId: brokerRowId,
      brokerClientId: body.brokerClientId,
      claimType: body.claimType,
      description: body.description.trim(),
      result,
    });

    return NextResponse.json({ ...result, analysisId });
  } catch (err) {
    console.error("[api/pre-sinistro] error:", err);
    const message = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function toEventType(claimType: string): "MORTE" | "INVALIDEZ" | "DOENCA_GRAVE" | "DIT" | "DIH" | "FUNERAL" {
  const t = claimType
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (t.includes("invalidez") || t.includes("ipa") || t.includes("ipd")) return "INVALIDEZ";
  if (t.includes("doenca") || t.includes("cancer")) return "DOENCA_GRAVE";
  if (t.includes("diaria") || t.includes("dit")) return "DIT";
  if (t.includes("internacao") || t.includes("dih") || t.includes("hospital")) return "DIH";
  if (t.includes("funeral")) return "FUNERAL";
  return "MORTE";
}

async function saveClaimAnalysis(params: {
  brokerId: string;
  brokerClientId?: string;
  claimType: string;
  description: string;
  result: Awaited<ReturnType<typeof analyzePreSinistro>>;
}): Promise<string | undefined> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("claim_analyses")
      .insert({
        broker_id: params.brokerId,
        broker_client_id: params.brokerClientId ?? null,
        event_type: toEventType(params.claimType),
        event_description: params.description,
        verdict: params.result.verdict,
        verdict_reason: params.result.rationale,
        sources: {
          citation: params.result.citation,
          evidenceSummary: params.result.evidenceSummary,
          model: params.result.model,
          chunks: params.result.chunks.slice(0, 12).map((chunk) => ({
            similarity: chunk.similarity,
            source_url: chunk.source_url,
            insurer_id: chunk.insurer_id,
            excerpt: chunk.content.slice(0, 500),
          })),
        },
        checklist: {
          documents: params.result.documentsChecklist,
          laudoTerms: params.result.laudoTerms,
          legalDisclaimer: params.result.legalDisclaimer,
        },
        risk_flags: params.result.riskFlags,
      } as never)
      .select("id")
      .single();

    if (error) {
      console.error("[api/pre-sinistro] failed to save claim analysis:", error.message);
      return undefined;
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.error("[api/pre-sinistro] failed to save claim analysis:", err);
    return undefined;
  }
}

async function brokerOwnsClient(brokerId: string, clientId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("broker_clients")
    .select("id")
    .eq("id", clientId)
    .eq("broker_id", brokerId)
    .maybeSingle();

  if (error) {
    console.error("[api/pre-sinistro] failed to validate client ownership:", error.message);
    return false;
  }

  return Boolean(data);
}
