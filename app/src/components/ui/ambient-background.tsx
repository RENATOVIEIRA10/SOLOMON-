import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * AmbientBackground — camada de profundidade visual.
 *
 * Compõe:
 *  - Vinheta radial sutil (foco no centro, bordas mais escuras)
 *  - Glow dourado flutuante (top-right)
 *  - Glow secundário discreto (bottom-left)
 *  - Grid técnico sutíssimo (apenas textura, sem poluir)
 *
 * Renderiza como fixed `inset-0 -z-10` para ficar atrás de tudo
 * sem interferir em interações.
 */
export function AmbientBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none fixed inset-0 -z-10", className)}
    >
      {/* Glow dourado superior direito — sol/halo (respira sob no-preference) */}
      <div
        className="absolute inset-0 ambient-drift-a"
        style={{
          background:
            "radial-gradient(900px 520px at 88% -8%, color-mix(in srgb, var(--ui-accent) var(--ambient-a), transparent), transparent 62%)",
        }}
      />
      {/* Glow secundário inferior esquerdo — equilíbrio (drift oposto) */}
      <div
        className="absolute inset-0 ambient-drift-b"
        style={{
          background:
            "radial-gradient(700px 460px at 0% 100%, color-mix(in srgb, var(--ui-accent) var(--ambient-b), transparent), transparent 60%)",
        }}
      />
      {/* Vinheta geral para foco no centro */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 100% 80% at 50% 0%, transparent 38%, color-mix(in srgb, var(--ui-bg) 55%, transparent) 100%)",
        }}
      />
      {/* Grid técnico sutil — apenas estrutura */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in srgb, var(--ui-accent) 3.5%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--ui-accent) 3.5%, transparent) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 30%, #000 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 60% at 50% 30%, #000 30%, transparent 80%)",
        }}
      />
    </div>
  );
}
