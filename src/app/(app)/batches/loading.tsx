import { SkeletonLoader } from "@/components/app/skeleton-loader";

export default function BatchesLoading() {
  return (
    <div className="space-y-6">
      <div className="h-16 border-b border-border" />
      <div className="rounded-md border border-border bg-surface-raised">
        <SkeletonLoader variant="table-rows" n={10} />
      </div>
    </div>
  );
}