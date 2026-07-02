"use client";

import Link from "next/link";
import { motion } from "motion/react";
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
 *  - "primary": herói da dashboard. Densidade alta, CTA grande.
 *    Usado em "Consultar SOLOMON".
 *  - "secondary": destaque secundário. Mais sóbrio, mas ainda
 *    premium. Usado em "Pré-Sinistro".
 *
 * Anima:
 *  - Entrada em cascata (controlled by `index`)
 *  - Hover: leve translateY + realce de borda
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
      className="relative h-full"
    >
      <Link
        href={href}
        aria-label={`${title} — ${cta}`}
        className={cn(
          "group relative flex h-full flex-col overflow-hidden rounded-2xl",
          "luxury-surface transition-premium",
          "hover:-translate-y-0.5",
          isPrimary
            ? "p-6 md:p-8 lg:p-10 hover:border-brand/50 hover:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75)]"
            : "p-6 md:p-7 hover:border-brand/40 hover:shadow-[0_18px_40px_-16px_rgba(0,0,0,0.7)]"
        )}
      >
        {/* Linha dourada superior — apenas primária */}
        {isPrimary && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/80 to-transparent"
          />
        )}

        {/* Cabeçalho técnico */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-md",
                "border border-edge",
                isPrimary
                  ? "bg-brand/15 text-brand-strong"
                  : "bg-brand/10 text-brand"
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <span className="mono-tag">{eyebrow}</span>
          </div>
          {meta && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted/55 hidden sm:inline">
              {meta}
            </span>
          )}
        </div>

        {/* Conteúdo */}
        <div className="mt-6 md:mt-8 flex-1 flex flex-col">
          <h3
            className={cn(
              "font-display tracking-tight text-ink",
              isPrimary
                ? "text-3xl md:text-4xl lg:text-5xl"
                : "text-2xl md:text-3xl"
            )}
          >
            {title}
          </h3>
          <p
            className={cn(
              "mt-3 max-w-2xl text-ink-muted leading-relaxed",
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
              isPrimary ? "text-brand" : "text-brand-strong"
            )}
          >
            {cta}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-muted/55">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand/60 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
            </span>
            Online
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
