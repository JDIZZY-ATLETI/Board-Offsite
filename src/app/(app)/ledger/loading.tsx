import { SkeletonLoader } from "@/components/app/skeleton-loader";

export default function LedgerLoading() {
  return (
    <div className="space-y-4">
      <div className="h-16 border-b border-border" />
      <SkeletonLoader variant="card" />
      <div className="rounded-md border border-border bg-surface-raised">
        <SkeletonLoader variant="table-rows" n={10} />
      </div>
    </div>
  );
}