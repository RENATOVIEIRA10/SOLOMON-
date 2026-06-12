"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary";

type FocusActionCardProps = {
  href: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  variant?: Variant;
  meta?: string; // pequena anotação técnica no canto (cockpit style)
  index?: number; // para cascata
};

/**
 * FocusActionCard — card de ação principal da dashboard.
 *
 * Variantes:
 *  - "primary": herói da dashboard. Densidade alta, glow dourado
 *    contínuo, CTA grande. Usado em "Consultar SOLOMON".
 *  - "secondary": destaque secundário. Mais sóbrio, mas ainda
 *    premium. Usado em "Pré-Sinistro".
 *
 * Anima:
 *  - Entrada em cascata (controlled by `index`)
 *  - Hover: leve translateY + glow adicional
 */
export function FocusActionCard({
  href,
  icon: Icon,
  eyebrow,
  title,
  description,
  cta,
  variant = "primary",
  meta,
  index = 0,
}: FocusActionCardProps) {
  const isPrimary = variant === "primary";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: 0.08 * index,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(
        "relative h-full",
        isPrimary ? "gold-halo" : ""
      )}
    >
      <Link
        href={href}
        aria-label={`${title} — ${cta}`}
        className={cn(
          "group relative flex h-full flex-col overflow-hidden rounded-2xl",
          "luxury-surface transition-premium",
          "hover:-translate-y-0.5",
          isPrimary
            ? "p-6 md:p-8 lg:p-10 hover:border-solomon-gold/50 hover:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75),0_0_32px_-6px_rgba(255,208,0,0.30)]"
            : "p-6 md:p-7 hover:border-solomon-gold/40 hover:shadow-[0_18px_40px_-16px_rgba(0,0,0,0.7),0_0_22px_-4px_rgba(255,208,0,0.18)]"
        )}
      >
        {/* Linha dourada superior — apenas primária */}
        {isPrimary && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-solomon-gold/80 to-transparent"
          />
        )}

        {/* Cabeçalho técnico */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-md",
                "border border-solomon-gold/25",
                isPrimary
                  ? "bg-solomon-gold/15 text-solomon-gold-light"
                  : "bg-solomon-gold/10 text-solomon-gold"
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <span className="mono-tag">{eyebrow}</span>
          </div>
          {meta && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/55 hidden sm:inline">
              {meta}
            </span>
          )}
        </div>

        {/* Conteúdo */}
        <div className="mt-6 md:mt-8 flex-1 flex flex-col">
          <h3
            className={cn(
              "font-display tracking-tight text-solomon-cream",
              isPrimary
                ? "text-3xl md:text-4xl lg:text-5xl"
                : "text-2xl md:text-3xl"
            )}
          >
            {title}
          </h3>
          <p
            className={cn(
              "mt-3 max-w-2xl text-solomon-cream-muted leading-relaxed",
              isPrimary ? "text-sm md:text-base" : "text-sm"
            )}
          >
            {description}
          </p>
        </div>

        {/* CTA + micro indicador de disponibilidade */}
        <div className="mt-6 md:mt-8 flex items-center justify-between gap-4">
          <span
            className={cn(
              "inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em]",
              isPrimary ? "text-solomon-gold" : "text-solomon-gold-light"
            )}
          >
            {cta}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-solomon-cream-muted/55">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-solomon-gold/60 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-solomon-gold" />
            </span>
            Online
          </span>
        </div>

        {/* Vinheta interna sutil apenas na primária */}
        {isPrimary && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              background:
                "radial-gradient(ellipse 60% 50% at 20% 0%, rgba(255, 208, 0, 0.10), transparent 60%)",
            }}
          />
        )}
      </Link>
    </motion.div>
  );
}
