"use client";

import { PageTransition } from "@/components/ui/page-transition";

/**
 * template.tsx — remonta a cada navegação no App Router.
 * É o ponto correto para transição de entrada (enter-only, sem AnimatePresence
 * de saída, que causa flash ao desmontar antes do next.js terminar a transição).
 */
export default function AppTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PageTransition>{children}</PageTransition>;
}
