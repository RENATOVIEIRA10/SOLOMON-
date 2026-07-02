"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

const THEME_COLOR = {
  light: "#f7f6f3",
  dark: "#0e0f11",
} as const;

const OVERRIDE_META_ID = "theme-color-override";

/**
 * Sincroniza a cor de chrome do browser/PWA (meta theme-color) com o modo
 * resolvido do next-themes (light/dark), incluindo override manual do
 * usuário — cenário que a media query `prefers-color-scheme` (usada no
 * `viewport.themeColor` SSR do layout) não cobre.
 *
 * Estratégia: o Next renderiza DUAS tags `<meta name="theme-color" media="...">`
 * (uma por color-scheme) a partir de `viewport.themeColor`. Browsers escolhem
 * entre elas pela media query, não pelo tema ativo da app — então se o usuário
 * troca o tema manualmente (independente do SO), essas tags continuam erradas.
 * Em vez de reescrever as duas tags media-based (frágil: teria que negar a
 * media query oposta), criamos/atualizamos UMA meta tag adicional, sem
 * atributo `media`, com um id fixo. Regra dos browsers (Chrome/Edge/Safari):
 * a ÚLTIMA `meta[name="theme-color"]` que casa é a que vale, e uma tag sem
 * `media` sempre casa — então colocada depois das duas SSR, ela vence
 * sempre, tanto no primeiro paint (que usa o fallback SSR media-based até o
 * client montar) quanto após qualquer toggle manual.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    // Pre-mount: resolvedTheme ainda é undefined (evita flash com valor errado).
    if (!resolvedTheme) return;

    const color =
      resolvedTheme === "dark" ? THEME_COLOR.dark : THEME_COLOR.light;

    let meta = document.getElementById(
      OVERRIDE_META_ID
    ) as HTMLMetaElement | null;

    if (!meta) {
      meta = document.createElement("meta");
      meta.id = OVERRIDE_META_ID;
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }

    meta.setAttribute("content", color);
  }, [resolvedTheme]);

  return null;
}
