import { NextRequest, NextResponse } from "next/server";
import { requireBrokerContext } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase";
import { currentLegalVersions } from "@/config/legal";

/**
 * Grava o consentimento LGPD do corretor autenticado (fluxo por convite, onde
 * o aceite acontece no /definir-senha e não no checkout público). Idempotente:
 * regrava a versão vigente + timestamp. Identidade vem da sessão, nunca do body.
 */
export async function POST(request: NextRequest) {
  const broker = await requireBrokerContext();
  if (broker instanceof NextResponse) return broker;

  const { privacyVersion, termsVersion } = currentLegalVersions();
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("brokers")
    .update({
      consent_privacy_version: privacyVersion,
      consent_terms_version: termsVersion,
      consent_accepted_at: new Date().toISOString(),
      consent_ip: ip,
    })
    .eq("id", broker.brokerId);

  if (error) {
    console.error("[api/consent] update failed:", error.message);
    return NextResponse.json({ error: "Falha ao registrar consentimento" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
