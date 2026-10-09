import { SkeletonLoader } from "@/components/app/skeleton-loader";

export default function RecordsLoading() {
  return (
    <div className="rounded-md border border-border bg-surface-raised">
      <SkeletonLoader variant="table-rows" n={10} />
    </div>
  );
}