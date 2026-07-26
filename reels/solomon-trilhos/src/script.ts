/**
 * Script + copy — DIRETO da landing oficial SOLOMON.
 *
 * Fonte: app/src/app/page.tsx + tagline em layout.tsx metadata.
 *
 * Regra absoluta:
 *  - Tagline canonica: "Certeza absoluta. Em segundos."
 *  - "absoluta" e "provar?" e "veredicto" sempre EM ITALIC GOLD (em da landing)
 *  - Nunca usar "trilhos" — sao PILARES, com nomes proprios:
 *      01 SOLOMON ao vivo
 *      02 Pre-Sinistro
 *      03 Comparador
 *  - Stats reais (NAO Ragas, isso e metrica de eval interna)
 *  - Separador entre items: "·" (interpunct)
 */

export type Caption = {
  from: number;
  duration: number;
  lines: string[];
};

// ─────────────────────────────────────────────────────────
// HERO
// ─────────────────────────────────────────────────────────

export const heroBadge = "Seu consultor privado de IA · Seguros de vida";

/**
 * Reproduz o <h1> da landing:
 *   Certeza absoluta.
 *   Em segundos.
 * Onde "absoluta." e italic gold.
 */
export const heroWords: { text: string; gold?: boolean; lineBreakAfter?: boolean }[] = [
  { text: "Certeza" },
  { text: "absoluta.", gold: true, lineBreakAfter: true },
  { text: "Em" },
  { text: "segundos." },
];

export const heroSub = "Responde com citação exata da cláusula\nde qualquer seguradora — em segundos.";

// ─────────────────────────────────────────────────────────
// CENA 2 — AO VIVO (terminal demo da landing)
// ─────────────────────────────────────────────────────────

export const aoVivoLabel = "SOLOMON · Resposta ao vivo";

export const aoVivoHeadline = {
  before: "Do oráculo ao ",
  italicGold: "veredicto.",
  after: "",
};

export const aoVivoCommand =
  'solomon ask "Suicídio coberto após 24m Prudential Vida Total?"';

export const aoVivoVerdict = "Coberto após carência";

export const aoVivoAnswer =
  "Sim. Após 24 meses de vigência, a cobertura por morte natural ou acidental inclui suicídio.";

export const aoVivoQuote =
  "A Seguradora garantirá o pagamento do Capital Seguro em caso de Morte Natural ou Acidental do Segurado, ocorrida após 24 meses de vigência da apólice.";

export const aoVivoSource = {
  file: "Condicoes_Gerais_Prudential_VidaTotal_2025.pdf",
  page: "p. 12",
  section: "§ 4.2",
};

// ─────────────────────────────────────────────────────────
// CENA 3 — PRE-SINISTRO
// ─────────────────────────────────────────────────────────

export const preSinistroLabel = "02 · Pré-Sinistro";

export const preSinistroHeadline = {
  before: "Antes do ",
  italicGold: "sinistro abrir,",
  after: "\nvocê já sabe.",
};

export const preSinistroBadges: { kind: "green" | "yellow" | "red"; text: string }[] = [
  { kind: "green", text: "Apólice vigente confirmada" },
  { kind: "yellow", text: "Evento dentro do período de carência" },
  { kind: "green", text: "Cobertura específica ativa" },
  { kind: "green", text: "Documentação completa" },
  { kind: "red", text: "Risk flag: cláusula de exclusão § 7.1" },
];

// ─────────────────────────────────────────────────────────
// CENA 4 — COMPARADOR
// ─────────────────────────────────────────────────────────

export const comparadorLabel = "03 · Comparador";

export const comparadorHeadline = {
  before: "Lado a lado.\nOnde você é ",
  italicGold: "superior.",
  after: "",
};

export const comparadorTable: {
  criterio: string;
  prudential: string;
  mag: string;
  better: "prudential" | "mag";
}[] = [
  { criterio: "Carência suicídio", prudential: "24 meses", mag: "36 meses", better: "prudential" },
  { criterio: "Doenças pré", prudential: "180 dias", mag: "90 dias", better: "mag" },
  { criterio: "Capital máximo", prudential: "R$ 5M", mag: "R$ 3M", better: "prudential" },
];

// ─────────────────────────────────────────────────────────
// CENA 5 — STATS (numeros reais da landing)
// ─────────────────────────────────────────────────────────

export const statsLabel = "SOLOMON · em números";

export type Stat = { target: number; suffix?: string; label: string };

export const stats: Stat[] = [
  { target: 14, suffix: "+", label: "Seguradoras indexadas" },
  { target: 16940, label: "Cláusulas analisadas" },
  { target: 3, suffix: "s", label: "Tempo médio de resposta" },
  { target: 24, suffix: "/7", label: "Disponibilidade contínua" },
];

// Lista REAL das seguradoras na landing
export const insurers: string[] = [
  "Prudential",
  "MAG",
  "Icatu",
  "MetLife",
  "Bradesco",
  "Azos",
  "SulAmérica",
  "Porto Seguro",
  "Liberty",
  "AXA",
  "Allianz",
  "HDI",
  "Mapfre",
  "Zurich",
];

// ─────────────────────────────────────────────────────────
// CENA 6 — CTA
// ─────────────────────────────────────────────────────────

export const ctaEyebrow = "Acesso exclusivo para corretores";

export const ctaHeadline = {
  before: "Pronto para ",
  italicGold: "provar?",
  after: "",
};

export const ctaDisclaimer =
  "Resposta em até 24h · Sem compromisso · Acesso por convite";

export const ctaHandle = "@reenatoviieira";

// ─────────────────────────────────────────────────────────
// FOOTER (rodape global do reel)
// ─────────────────────────────────────────────────────────

export const footerLogo = "SOLOMON";
export const footerMeta = "Oráculo de Seguros de Vida · © 2026 AUR.IOs";

// ─────────────────────────────────────────────────────────
// VOICEOVER
// ─────────────────────────────────────────────────────────

/**
 * Narracao off-camera. ~95 palavras, ~35s @ 165wpm.
 * Tom: editorial, pausado, grave. NAO efusivo.
 * Voz recomendada: ElevenLabs Adam V2 PT-BR ou voz brasileira masculina
 * grave (Daniel Brassan-style). NUNCA voz feminina pop ou narrador de TV.
 */
export const voiceoverScript = `
Certeza absoluta. Em segundos.

SOLOMON é seu consultor privado de IA para seguros de vida.

Pergunta livre, qualquer seguradora — resposta com citação da cláusula exata.
Página. Parágrafo. Documento.

Antes do sinistro abrir, você já sabe se cobre, se tem carência, e qual a risk flag.

Compara seguradoras lado a lado e mostra onde você é superior.

Quatorze seguradoras indexadas. Dezesseis mil cláusulas analisadas. Resposta em três segundos.

Não interpreta. Não chuta. Prova.

A diferença entre chutar e saber.
`.trim();
