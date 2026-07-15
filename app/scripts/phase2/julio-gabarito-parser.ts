export interface GabaritoEntry {
  id: string; insurer: string; product: string;
  verdict: "COBERTO" | "NAO_COBERTO" | "RISCO" | null;
  decisiveClause: string | null; missingFacts: string | null;
  confidence: "alta" | "media" | "baixa" | null; justification: string | null;
}

const FIELD = (line: string, label: string): string | null => {
  const re = new RegExp(`${label}:\\s*([^|]+?)\\s*(?:\\||$)`, "i");
  const m = line.match(re);
  const v = m?.[1]?.trim();
  return !v || v === "___" ? null : v;
};

export function parseGabarito(md: string): GabaritoEntry[] {
  const blocks = md.split(/^###\s+/m).slice(1);
  const out: GabaritoEntry[] = [];
  for (const b of blocks) {
    const header = b.split("\n")[0];
    const idm = header.match(/^(Q\d+)\s*—\s*(.+?)\s*·\s*(.+)$/);
    if (!idm) continue;
    const respLine = b.split("\n").find((l) => l.includes("RESPOSTA")) ?? "";
    const rawVerdict = FIELD(respLine, "Veredicto");
    const verdict = rawVerdict && ["COBERTO", "NAO_COBERTO", "RISCO"].includes(rawVerdict)
      ? (rawVerdict as GabaritoEntry["verdict"]) : null;
    const rawConf = FIELD(respLine, "Confian[cç]a")?.toLowerCase().replace("é", "e") ?? null;
    const confidence = rawConf && ["alta", "media", "baixa"].includes(rawConf)
      ? (rawConf as GabaritoEntry["confidence"]) : null;
    out.push({
      id: idm[1], insurer: idm[2].trim(), product: idm[3].trim(),
      verdict, confidence,
      decisiveClause: FIELD(respLine, "Cl[aá]usula decisiva"),
      missingFacts: FIELD(respLine, "Fatos ausentes"),
      justification: FIELD(respLine, "Justificativa"),
    });
  }
  return out;
}
