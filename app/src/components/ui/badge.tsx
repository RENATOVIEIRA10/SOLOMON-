import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border",
  {
    variants: {
      variant: {
        neutral: "bg-solomon-charcoal text-solomon-cream-muted border-solomon-gold/15",
        accent: "bg-solomon-gold/15 text-solomon-gold border-solomon-gold/25",
        success: "bg-green-500/15 text-green-300 border-green-400/25",
        warning: "bg-amber-500/15 text-amber-300 border-amber-400/25",
        danger: "bg-red-500/15 text-red-300 border-red-400/25",
        info: "bg-blue-500/15 text-blue-300 border-blue-400/25",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
