import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export type SkeletonVariant = "kpi-grid" | "table-rows" | "card" | "stepper" | "drawer" | "diff" | "page";

export interface SkeletonLoaderProps {
  variant: SkeletonVariant;
  /** Rows for `table-rows` (default 8). */
  n?: number;
  className?: string;
}

/** docs/ux-design.md section 4.19. Dimensions match final layouts to avoid layout shift. */
export function SkeletonLoader({ variant, n = 8, className }: SkeletonLoaderProps) {
  switch (variant) {
    case "kpi-grid":
      return (
        <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)} aria-busy="true" aria-label="Loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-md border border-border bg-surface-raised p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-3 h-8 w-20" />
              <Skeleton className="mt-3 h-3 w-32" />
            </div>
          ))}
        </div>
      );
    case "table-rows":
      return (
        <div className={cn("divide-y divide-border", className)} aria-busy="true" aria-label="Loading">
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="flex h-10 items-center gap-4 px-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      );
    case "stepper":
      return (
        <div className={cn("flex items-center gap-3 overflow-hidden py-2", className)} aria-busy="true" aria-label="Loading">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3 w-20" />
              {i < 7 ? <Skeleton className="h-px w-8" /> : null}
            </div>
          ))}
        </div>
      );
    case "drawer":
      return (
        <div className={cn("space-y-4 p-6", className)} aria-busy="true" aria-label="Loading">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    case "diff":
      return (
        <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-3 gap-4">
              <Skeleton className="h-4" />
              <Skeleton className="h-4" />
              <Skeleton className="h-4" />
            </div>
          ))}
        </div>
      );
    case "page":
      return (
        <div className={cn("space-y-6", className)} aria-busy="true" aria-label="Loading">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96" />
          <SkeletonLoader variant="table-rows" n={6} />
        </div>
      );
    case "card":
    default:
      return (
        <div className={cn("rounded-md border border-border bg-surface-raised p-5", className)} aria-busy="true" aria-label="Loading">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
      );
  }
}