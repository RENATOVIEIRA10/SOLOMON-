import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 font-mono uppercase tracking-widest rounded border",
  {
    variants: {
      variant: {
        neutral: "bg-surface-2 text-ink-muted border-edge",
        accent: "bg-brand/10 text-brand border-brand/25",
        success: "bg-success/10 text-success border-success/25",
        warning: "bg-warning/10 text-warning border-warning/25",
        danger: "bg-danger/10 text-danger border-danger/25",
        info: "bg-info/10 text-info border-info/25",
      },
      size: {
        sm: "text-[9px] px-1.5 py-0.5",
        md: "text-[10px] px-2.5 py-1",
      },
    },
    defaultVariants: { variant: "neutral", size: "sm" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
