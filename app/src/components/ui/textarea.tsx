import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "flex w-full rounded-md border border-solomon-gold/20 bg-solomon-charcoal/60 px-4 py-3 text-sm text-solomon-cream placeholder:text-solomon-cream-muted/40 focus:outline-none focus:border-solomon-gold focus:ring-2 focus:ring-solomon-gold/20 disabled:cursor-not-allowed disabled:opacity-50 resize-none",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
