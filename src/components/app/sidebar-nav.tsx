"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Database, FolderOpen, Hourglass, KeyRound, LayoutDashboard, Link2, PanelLeft, ScrollText, Settings, ShieldCheck, Upload, Users, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavGroup, NavIcon } from "@/lib/ui/nav";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RoleChip } from "./role-chip";
import type { Role } from "@/types";

export interface SidebarNavProps {
  nav: NavGroup[];
  user: { userId: string; role: Role; employerId: string | null };
  showDevLogin: boolean;
  /** Rendered inside the off-canvas sheet: no collapse control. */
  inSheet?: boolean;
  onNavigate?(): void;
}

const STORAGE_KEY = "hoopp.sidebar.collapsed";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  upload: Upload,
  batches: FolderOpen,
  pending: Hourglass,
  ledger: Link2,
  members: UserRound,
  ariel: Database,
  rules: Settings,
  roles: Users,
  audit: ScrollText,
};

export function useSidebarCollapsed(): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setCollapsed(stored === "1");
      else if (window.matchMedia("(max-width: 1279px)").matches) setCollapsed(true);
    } catch {
      // localStorage unavailable
    }
  }, []);
  const set = React.useCallback((v: boolean) => {
    setCollapsed(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);
  return [collapsed, set];
}

/** Role-filtered navigation (items come pre-filtered from the server). `[` toggles the rail. */
export function SidebarNav({ nav, user, showDevLogin, inSheet = false, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const isCollapsed = !inSheet && collapsed;

  React.useEffect(() => {
    if (inSheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setCollapsed(!collapsed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, inSheet, setCollapsed]);

  const isActive = (href: string, match: "exact" | "prefix" | undefined) => {
    const [path, qs] = href.split("?");
    if (qs) {
      const want = new URLSearchParams(qs);
      for (const [k, v] of want) if (search.get(k) !== v) return false;
      return pathname === path;
    }
    // "/batches?status=PENDING_APPROVAL" is its own saved view: keep "Batches" inactive there.
    if (path === "/batches" && pathname === path && search.get("status") === "PENDING_APPROVAL") return false;
    return (match ?? (path === "/" ? "exact" : "prefix")) === "exact" ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <div className={cn("flex h-full flex-col bg-surface", isCollapsed ? "w-sidebar-rail" : "w-sidebar")} data-collapsed={isCollapsed}>
      <div className={cn("flex h-topbar items-center gap-2 border-b border-border px-3", isCollapsed && "justify-center")}>
        <Link href="/" className="flex items-center gap-2 rounded-sm" aria-label={isCollapsed ? "HOOPP Events Validation ledger home" : undefined} onClick={onNavigate}>
          <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-brand text-white">
            <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          </span>
          {!isCollapsed ? (
            <span className="leading-tight">
              <span className="block text-body-strong font-semibold text-ink">HOOPP Events</span>
              <span className="block text-caption text-ink-muted">Validation ledger</span>
            </span>
          ) : null}
        </Link>
      </div>
      <nav aria-label="Sidebar navigation" className="flex-1 overflow-y-auto px-2 py-3">
        {nav.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-4")}>
            {group.label && !isCollapsed ? <p className="px-2 pb-1 text-caption font-medium uppercase tracking-wide text-ink-faint">{group.label}</p> : null}
            {group.label && isCollapsed && gi > 0 ? <div className="mx-2 mb-2 h-px bg-border" aria-hidden="true" /> : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href, item.match);
                const Icon = ICONS[item.icon];
                const disabled = item.phase !== undefined;
                const inner = (
                  <>
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    {!isCollapsed ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
                    {!isCollapsed && disabled ? <span className="ml-auto rounded-sm bg-surface-raised px-1 text-[10px] font-medium text-ink-faint">P{item.phase}</span> : null}
                  </>
                );
                const classes = cn(
                  "flex h-9 items-center gap-2.5 rounded-sm px-2 text-body transition-colors",
                  isCollapsed && "justify-center",
                  active ? "bg-brand-soft font-medium text-brand" : "text-ink-muted hover:bg-surface-raised hover:text-ink",
                  disabled && "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-ink-muted",
                );
                const node = disabled ? (
                  <span className={classes} aria-disabled="true" tabIndex={0}>
                    {inner}
                  </span>
                ) : (
                  <Link href={item.href} aria-current={active ? "page" : undefined} className={classes} onClick={onNavigate}>
                    {inner}
                  </Link>
                );
                const tip = disabled ? `${item.label} — available in Phase ${item.phase}` : isCollapsed ? item.label : null;
                return (
                  <li key={item.href}>
                    {tip ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{node}</TooltipTrigger>
                        <TooltipContent side="right">{tip}</TooltipContent>
                      </Tooltip>
                    ) : (
                      node
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        {!isCollapsed ? <RoleChip role={user.role} employerId={user.employerId} userId={user.userId} /> : <RoleChip role={user.role} employerId={user.employerId} compact />}
        <div className={cn("mt-2 flex items-center gap-1", isCollapsed ? "flex-col" : "justify-between")}>
          {showDevLogin ? (
            <Link href="/login" className="inline-flex h-7 items-center gap-1 rounded-sm px-1.5 text-caption text-ink-muted hover:bg-surface-raised hover:text-ink" onClick={onNavigate}>
              <KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
              {!isCollapsed ? "Dev login" : <span className="sr-only">Dev login</span>}
            </Link>
          ) : (
            <span />
          )}
          {!inSheet ? (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-pressed={isCollapsed}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={`${isCollapsed ? "Expand" : "Collapse"} sidebar ([)`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              <PanelLeft aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}