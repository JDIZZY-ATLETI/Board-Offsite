import { SkeletonLoader } from "@/components/app/skeleton-loader";

export default function BatchLoading() {
  return (
    <div className="space-y-6">
      <SkeletonLoader variant="kpi-grid" />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonLoader variant="card" />
        <SkeletonLoader variant="card" />
      </div>
    </div>
  );
}