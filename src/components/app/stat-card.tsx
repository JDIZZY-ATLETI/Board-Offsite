import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, formatInt, formatMoney, formatPercent } from "@/lib/ui/format";
import { Skeleton } from "@/components/ui/skeleton";

export interface StatCardProps {
  label: string;
  value: string | number | null | undefined;
  format?: "int" | "pct" | "money" | "duration" | "raw";
  delta?: { value: number; direction: "up" | "down"; good: boolean; label: string };
  status?: "ok" | "attention" | "bad" | "neutral";
  href?: string;
  icon?: LucideIcon;
  footer?: React.ReactNode;
  loading?: boolean;
  className?: string;
  "data-testid"?: string;
}

const STATUS_BAR: Record<NonNullable<StatCardProps["status"]>, string> = {
  ok: "bg-st-ok",
  attention: "bg-st-attention",
  bad: "bg-st-bad",
  neutral: "bg-border",
};

function formatValue(v: StatCardProps["value"], f: StatCardProps["format"]): string {
  if (v === null || v === undefined) return "—";
  switch (f) {
    case "pct":
      return formatPercent(typeof v === "number" ? v : Number(v));
    case "money":
      return formatMoney(v);
    case "duration":
      return formatDuration(typeof v === "number" ? v : Number(v));
    case "raw":
      return String(v);
    default:
      return formatInt(v);
  }
}

/** KPI card (docs/ux-design.md section 4.16). Whole card is a link when `href` is set. */
export function StatCard({ label, value, format = "int", delta, status = "neutral", href, icon: Icon, footer, loading, className, ...rest }: StatCardProps) {
  const body = (
    <>
      <span aria-hidden="true" className={cn("absolute inset-y-3 left-0 w-1 rounded-r-full", STATUS_BAR[status])} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-small font-medium text-ink-muted">{label}</p>
        {Icon ? <Icon aria-hidden="true" className="h-4 w-4 text-ink-faint" /> : null}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <p className="mt-1 text-display tabular-nums text-ink">{formatValue(value, format)}</p>
      )}
      {delta && !loading ? (
        <p className={cn("mt-1 flex items-center gap-1 text-caption", delta.good ? "text-ok-text" : "text-sev-cme-text")}>
          {delta.direction === "up" ? <ArrowUp aria-hidden="true" className="h-3 w-3" /> : <ArrowDown aria-hidden="true" className="h-3 w-3" />}
          <span>
            {delta.value} {delta.label}
          </span>
        </p>
      ) : null}
      {footer ? <div className="mt-2 text-small text-ink-muted">{footer}</div> : null}
    </>
  );
  const classes = cn("relative block rounded-md border border-border bg-surface-raised p-5 pl-6 shadow-card", href && "transition-colors hover:border-brand/40 hover:bg-surface", className);
  if (href) {
    return (
      <Link href={href} className={classes} data-testid={rest["data-testid"]}>
        {body}
      </Link>
    );
  }
  return (
    <div className={classes} data-testid={rest["data-testid"]}>
      {body}
    </div>
  );
}