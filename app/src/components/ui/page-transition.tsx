"use client";

import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

/**
 * PageTransition — fade + lift sutil na entrada de cada rota.
 *
 * Caráter premium: 0.4s, cubic-bezier(0.22, 1, 0.36, 1), lift de 10px.
 * Sob prefers-reduced-motion: sem movimento (opacity apenas, ou mesmo
 * skip total via duration 0 para não causar flash).
 *
 * Usado via template.tsx no grupo (app) — remonta a cada navegação.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      key={pathname}
      initial={
        shouldReduceMotion
          ? { opacity: 1, y: 0 }
          : { opacity: 0, y: 10 }
      }
      animate={{ opacity: 1, y: 0 }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
      }
      className="flex flex-col flex-1"
    >
      {children}
    </motion.div>
  );
}
