"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface TabItem {
  label: string;
  href: string;
  count?: number;
  hidden?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Exact match (default) or prefix match on the pathname. */
  match?: "exact" | "prefix";
}

export interface TabsNavProps {
  tabs: TabItem[];
  label: string;
  className?: string;
}

/** <nav aria-label> + <a aria-current="page"> (docs/ux-design.md section 2.4). */
export function TabsNav({ tabs, label, className }: TabsNavProps) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={cn("-mb-px flex gap-1 overflow-x-auto", className)}>
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => {
          const path = t.href.split("?")[0];
          const active = (t.match ?? "exact") === "exact" ? pathname === path : pathname.startsWith(path);
          const classes = cn(
            "inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-body font-medium transition-colors",
            active ? "border-brand text-brand" : "border-transparent text-ink-muted hover:border-border hover:text-ink",
            t.disabled && "cursor-not-allowed opacity-50 hover:border-transparent hover:text-ink-muted",
          );
          const content = (
            <>
              <span>{t.label}</span>
              {t.count !== undefined ? <span className={cn("rounded-full px-1.5 text-caption tabular-nums", active ? "bg-brand-soft text-brand" : "bg-surface text-ink-muted")}>{t.count}</span> : null}
            </>
          );
          if (t.disabled) {
            return (
              <Tooltip key={t.href}>
                <TooltipTrigger asChild>
                  <span className={classes} aria-disabled="true" tabIndex={0}>
                    {content}
                  </span>
                </TooltipTrigger>
                {t.disabledReason ? <TooltipContent>{t.disabledReason}</TooltipContent> : null}
              </Tooltip>
            );
          }
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={classes}>
              {content}
            </Link>
          );
        })}
    </nav>
  );
}