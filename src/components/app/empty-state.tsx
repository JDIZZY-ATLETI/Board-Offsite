import * as React from "react";
import { Inbox, Search, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  illustration?: "inbox" | "search" | "shield" | "none";
  compact?: boolean;
  className?: string;
}

const ICONS = { inbox: Inbox, search: Search, shield: ShieldCheck } as const;

/** docs/ux-design.md section 4.20. Every empty state names the next action (P5). */
export function EmptyState({ title, description, action, illustration = "none", compact = false, className }: EmptyStateProps) {
  const Icon = illustration === "none" ? null : ICONS[illustration];
  return (
    <div className={cn("mx-auto flex max-w-[420px] flex-col items-center text-center", compact ? "gap-2 py-6" : "gap-3 py-12", className)}>
      {Icon ? <Icon aria-hidden="true" className="h-10 w-10 text-ink-faint" strokeWidth={1.5} /> : null}
      <h3 className="text-h3 text-ink">{title}</h3>
      {description ? <p className="text-body text-ink-muted">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}