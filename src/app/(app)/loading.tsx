import { SkeletonLoader } from "@/components/app/skeleton-loader";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-16 border-b border-border" />
      <SkeletonLoader variant="kpi-grid" />
      <div className="grid gap-6 xl:grid-cols-2">
        <SkeletonLoader variant="card" />
        <SkeletonLoader variant="card" />
      </div>
    </div>
  );
}