import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("ui-skeleton rounded-md", className)} />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2.5">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-edge bg-surface p-6" role="status" aria-label="Carregando">
      <Skeleton className="h-3 w-24 mb-4" />
      <Skeleton className="h-6 w-2/3 mb-2" />
      <Skeleton className="h-3.5 w-full" />
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="rounded-lg border border-edge bg-surface p-6" role="status" aria-label="Carregando">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-9 w-16" />
    </div>
  );
}
