"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Eixo MODO (light/dark/system) — gerenciado pelo next-themes via class no <html>.
 * O eixo ACENTO (classic/midnight/emerald, key "solomon-theme") continua manual
 * no AppShell/ProfileView. Os dois eixos são independentes.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="solomon-mode"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
