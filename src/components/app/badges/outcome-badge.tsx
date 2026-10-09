import { OUTCOME_MAP } from "@/lib/ui/status-map";
import type { RecordOutcome } from "@/types";
import { SemanticBadge } from "./semantic-badge";

export interface OutcomeBadgeProps {
  outcome: RecordOutcome;
  size?: "sm" | "md";
  className?: string;
}

export function OutcomeBadge({ outcome, size = "md", className }: OutcomeBadgeProps) {
  return <SemanticBadge entry={OUTCOME_MAP[outcome]} value={outcome} size={size} className={className} data-testid={`outcome-badge-${outcome}`} />;
}