import { SEVERITY_MAP, SEVERITY_SHORT } from "@/lib/ui/status-map";
import type { FindingSeverity } from "@/types";
import { SemanticBadge } from "./semantic-badge";

export interface SeverityBadgeProps {
  severity: FindingSeverity;
  size?: "sm" | "md";
  /** Renders "Warning · 3". */
  count?: number;
  short?: boolean;
  className?: string;
}

export function SeverityBadge({ severity, size = "md", count, short = false, className }: SeverityBadgeProps) {
  const entry = SEVERITY_MAP[severity];
  const base = short ? SEVERITY_SHORT[severity] : entry.label;
  const label = count !== undefined ? `${base} · ${count}` : base;
  return <SemanticBadge entry={entry} value={severity} size={size} label={label} className={className} data-testid={`severity-badge-${severity}`} />;
}