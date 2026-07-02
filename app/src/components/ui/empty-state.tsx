import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 py-12 text-center", className)}>
      <Icon className="size-8 text-ink-muted/40" aria-hidden="true" />
      <p className="text-sm text-ink font-medium">{title}</p>
      {description && <p className="text-xs text-ink-muted max-w-sm">{description}</p>}
      {action &&
        ("href" in action ? (
          <Link href={action.href} className="mt-1 text-xs text-brand hover:text-brand-strong transition-colors">
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className="mt-1 text-xs text-brand hover:text-brand-strong transition-colors cursor-pointer">
            {action.label}
          </button>
        ))}
    </div>
  );
}
