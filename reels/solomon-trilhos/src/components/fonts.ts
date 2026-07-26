/**
 * Carregamento das fontes via @remotion/google-fonts.
 * Cormorant Garamond e a fonte de assinatura do SOLOMON.
 *
 * Importar `await loadFonts()` no Root antes de registrar a Composition,
 * OU simplesmente importar este modulo em algum lugar pra o bundler
 * resolver e o Remotion fazer wait-for-fonts antes de renderizar.
 */

import { loadFont as loadCormorant } from "@remotion/google-fonts/CormorantGaramond";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadJetBrains } from "@remotion/google-fonts/JetBrainsMono";

export const cormorantHandle = loadCormorant("normal", {
  weights: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
});

export const cormorantItalicHandle = loadCormorant("italic", {
  weights: ["300", "400", "500", "600"],
  subsets: ["latin"],
});

export const interHandle = loadInter("normal", {
  weights: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
});

export const jetbrainsHandle = loadJetBrains("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});

export const cormorantFamily = cormorantHandle.fontFamily;
export const cormorantItalicFamily = cormorantItalicHandle.fontFamily;
export const interFamily = interHandle.fontFamily;
export const jetbrainsFamily = jetbrainsHandle.fontFamily;
