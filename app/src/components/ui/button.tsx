import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-solomon-gold text-solomon-black hover:bg-solomon-gold-light shadow-sm hover:shadow-md hover:shadow-solomon-gold/20",
        ghost:
          "text-solomon-cream hover:bg-solomon-graphite hover:text-solomon-gold-light",
        outline:
          "border border-solomon-gold/30 bg-solomon-graphite/40 text-solomon-cream hover:bg-solomon-graphite hover:border-solomon-gold/60",
        secondary:
          "bg-solomon-charcoal text-solomon-cream hover:bg-solomon-charcoal/80",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-solomon-gold underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 [&_svg]:size-4",
        sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
        lg: "h-12 px-6 text-base [&_svg]:size-4",
        icon: "h-10 w-10 [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
