export interface GabaritoEntry {
  id: string; insurer: string; product: string;
  /** Descricao do caso (linha `**Fatos:**`) — input do harness de correctness (T4). */
  facts: string | null;
  verdict: "COBERTO" | "NAO_COBERTO" | "RISCO" | null;
  decisiveClause: string | null; missingFacts: string | null;
  confidence: "alta" | "media" | "baixa" | null; justification: string | null;
}

const VALID_VERDICTS = ["COBERTO", "NAO_COBERTO", "RISCO"] as const;
const VALID_CONFIDENCE = ["alta", "media", "baixa"] as const;

const FIELD = (line: string, label: string): string | null => {
  const re = new RegExp(`${label}:\\s*([^|]+?)\\s*(?:\\||$)`, "i");
  const m = line.match(re);
  const v = m?.[1]?.trim();
  return !v || v === "___" ? null : v;
};

export function parseGabarito(md: string): GabaritoEntry[] {
  // Normalize CRLF -> LF first: on a core.autocrlf=true checkout (this repo has
  // no .gitattributes forcing LF on .md), the header regex below uses `.+`,
  // which never matches `\r`, so a CRLF file would silently parse to 0 entries.
  const normalized = md.replace(/\r\n/g, "\n");
  const blocks = normalized.split(/^###\s+/m).slice(1);
  const out: GabaritoEntry[] = [];
  for (const b of blocks) {
    const lines = b.split("\n");
    const header = lines[0];
    const idm = header.match(/^(Q\d+)\s*—\s*(.+?)\s*·\s*(.+)$/);
    if (!idm) continue;
    // Join the RESPOSTA block (not just its first physical line): Julio's
    // justification often wraps onto a second line, and fields after the wrap
    // would otherwise parse as null even when filled in. Bounded to the first
    // blank line after the marker — Julio's RESPOSTA paragraph is always
    // followed by a blank line before `---`/next `###` — so we don't absorb
    // the rest of the block (separator, next heading, file footer) when the
    // last field on the line lacks a trailing `|`.
    const respIdx = lines.findIndex((l) => l.includes("RESPOSTA"));
    let respBlock = "";
    if (respIdx !== -1) {
      let end = respIdx;
      while (end < lines.length && lines[end].trim() !== "") end++;
      respBlock = lines.slice(respIdx, end).join(" ");
    }
    // Fatos: mesmo tratamento de wrap do RESPOSTA — junta a partir da linha
    // `**Fatos:**` ate a linha RESPOSTA ou linha em branco, o que vier antes.
    const factsIdx = lines.findIndex((l) => /^\*\*Fatos:\*\*/.test(l.trim()));
    let facts: string | null = null;
    if (factsIdx !== -1) {
      let end = factsIdx;
      while (
        end < lines.length &&
        lines[end].trim() !== "" &&
        !(end > factsIdx && lines[end].includes("RESPOSTA"))
      ) end++;
      facts = lines.slice(factsIdx, end).join(" ")
        .replace(/^\*\*Fatos:\*\*\s*/, "").trim() || null;
    }
    const rawVerdict = FIELD(respBlock, "Veredicto");
    const verdict = rawVerdict && (VALID_VERDICTS as readonly string[]).includes(rawVerdict)
      ? (rawVerdict as GabaritoEntry["verdict"]) : null;
    const rawConf = FIELD(respBlock, "Confian[cç]a")?.toLowerCase().replace("é", "e") ?? null;
    const confidence = rawConf && (VALID_CONFIDENCE as readonly string[]).includes(rawConf)
      ? (rawConf as GabaritoEntry["confidence"]) : null;
    out.push({
      id: idm[1], insurer: idm[2].trim(), product: idm[3].trim(),
      facts, verdict, confidence,
      decisiveClause: FIELD(respBlock, "Cl[aá]usula decisiva"),
      missingFacts: FIELD(respBlock, "Fatos ausentes"),
      justification: FIELD(respBlock, "Justificativa"),
    });
  }
  return out;
}
