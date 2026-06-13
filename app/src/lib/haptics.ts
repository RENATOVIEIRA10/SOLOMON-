/**
 * tapHaptic — feedback tátil sutil ao tocar na nav.
 *
 * 8ms = tick sutil, perceptível mas não invasivo.
 * iOS ignora navigator.vibrate silenciosamente (não suportado).
 * Guard "in navigator" evita throw em ambientes sem suporte (SSR, bots).
 */
export function tapHaptic(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(8);
  }
}
