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
      {/* Glow dourado superior direito — sol/halo */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 520px at 88% -8%, rgba(255, 208, 0, 0.16), transparent 62%)",
        }}
      />
      {/* Glow secundário inferior esquerdo — equilíbrio */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(700px 460px at 0% 100%, rgba(255, 208, 0, 0.08), transparent 60%)",
        }}
      />
      {/* Vinheta geral para foco no centro */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 100% 80% at 50% 0%, transparent 38%, rgba(0, 0, 0, 0.55) 100%)",
        }}
      />
      {/* Grid técnico sutil — apenas estrutura */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255, 208, 0, 0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 208, 0, 0.035) 1px, transparent 1px)",
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
