import { batchStatusEntry, isTransientStatus } from "@/lib/ui/status-map";
import type { BatchStatus } from "@/types";
import { SemanticBadge } from "./semantic-badge";

export interface StatusBadgeProps {
  status: BatchStatus;
  heldCount?: number;
  size?: "sm" | "md";
  showIcon?: boolean;
  pulse?: boolean;
  className?: string;
}

export function StatusBadge({ status, heldCount = 0, size = "md", showIcon = true, pulse, className }: StatusBadgeProps) {
  const entry = batchStatusEntry(status, heldCount);
  const shouldPulse = pulse ?? isTransientStatus(status);
  return <SemanticBadge entry={entry} value={status} size={size} showIcon={showIcon} pulse={shouldPulse} className={className} data-testid={`status-badge-${status}`} />;
}