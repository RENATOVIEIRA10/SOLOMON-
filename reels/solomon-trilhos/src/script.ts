/**
 * Script narrativo + legendas.
 *
 * Tom: insider. Quem fala conhece o produto por dentro.
 * NUNCA mencionar "IA generativa", "inteligencia artificial revolucionaria",
 * "transformar a industria". Esse vocabulario e cliche e desautoriza o reel.
 *
 * Timings em frames @ 30fps.
 */

export type Caption = {
  /** Frame de entrada (relativo a Sequence pai, nao absoluto) */
  from: number;
  /** Duracao em frames */
  duration: number;
  /** Linhas — quebra manual, sem auto-wrap */
  lines: string[];
};

/**
 * Hook: estabelece o problema, sem dizer "IA".
 * Cada palavra-chave entra separada para dar peso.
 */
export const hookCaptions: Caption[] = [
  { from: 6, duration: 36, lines: ["15 seguradoras."] },
  { from: 48, duration: 38, lines: ["200 paginas", "de contrato cada."] },
  { from: 92, duration: 50, lines: ["Seu cliente espera", "30 segundos."] },
];

export const trilho1Caption: Caption = {
  from: 12,
  duration: 198,
  lines: ["trilho 1 — cotacao"],
};

export const trilho1Subtitle = "tabela de premio. zero LLM. F=1.00.";

export const trilho2Caption: Caption = {
  from: 12,
  duration: 198,
  lines: ["trilho 2 — oraculo"],
};

export const trilho2Subtitle = "pergunta livre. citacao com pagina.";

export const trilho3Caption: Caption = {
  from: 12,
  duration: 198,
  lines: ["trilho 3 — pre-sinistro"],
};

export const trilho3Subtitle = "veredicto antes do aviso.";

/**
 * Eval scene: defende a tese de "nao shipamos no escuro".
 */
export const evalHeadline = "49 perguntas.";
export const evalSubheadline = "1 corretor validou cada uma.";
export const evalFooterPrimary = "5 metricas. 3 modelos.";
export const evalFooterSecondary = "nenhum chute em producao.";

/**
 * Outro: handle + tagline.
 */
export const outroTagline = "para corretores que nao vendem palpite.";
export const outroHandle = "@reenatoviieira";

/**
 * Script da narracao (off-camera).
 * 96 palavras @ ~165wpm = ~35s. Usar ElevenLabs voz PT-BR neutra,
 * masculina, registro grave. Ver README.md "Voiceover".
 *
 * Marcas temporais sao sugestao — alinhar depois do TTS pronto.
 */
export const voiceoverScript = `
Existem 15 seguradoras de vida no Brasil.
Cada uma com mais de 200 paginas de contrato.
Seu cliente espera resposta em 30 segundos.

Trilho 1: cotacao. Tabela de premio. Zero LLM. Numero exato em meio segundo.

Trilho 2: oraculo. Pergunta livre, busca em 15 contratos, resposta com pagina citada.

Trilho 3: pre-sinistro. Antes do segurado abrir aviso, voce ja sabe se cobre, com qual clausula e qual o risco.

Cada resposta passa por 5 metricas.
Cada metrica passa por um corretor real.

Solomon nao foi feito pra parecer inteligente.
Foi feito pra parar de errar.
`.trim();
