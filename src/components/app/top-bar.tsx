"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, LogOut, Menu, UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { shortBatchId } from "@/lib/ui/format";
import { ROLE_LABELS, type NavGroup } from "@/lib/ui/nav";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar-nav";
import type { Role } from "@/types";

export interface TopBarProps {
  user: { userId: string; role: Role; employerId: string | null };
  env: "local" | "dev" | "prod";
  nav: NavGroup[];
  showDevLogin: boolean;
}

const SEGMENT_LABELS: Record<string, string> = {
  batches: "Batches",
  upload: "Upload",
  ledger: "Ledger",
  findings: "Findings",
  records: "Records",
  reports: "Reports",
  "update-set": "Update Set",
  members: "Members",
  ariel: "Mock Ariel",
  admin: "Admin",
  rules: "Rules & config",
  forbidden: "Access denied",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function crumbsFor(pathname: string): Array<{ label: string; href: string }> {
  const parts = pathname.split("/").filter(Boolean);
  const out: Array<{ label: string; href: string }> = [];
  let acc = "";
  for (const p of parts) {
    acc += `/${p}`;
    out.push({ label: UUID.test(p) ? shortBatchId(p) : (SEGMENT_LABELS[p] ?? decodeURIComponent(p)), href: acc });
  }
  return out;
}

/** 56 px bar: breadcrumb · environment pill · user menu (docs/ux-design.md section 2.1). */
export function TopBar({ user, env, nav, showDevLogin }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const crumbs = crumbsFor(pathname);

  const signOut = async () => {
    const res = await fetch("/api/auth/dev-login", { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't sign out");
      return;
    }
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 flex h-topbar items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>
          <Menu aria-hidden="true" />
        </Button>
        <SheetContent side="left" className="w-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav nav={nav} user={user} showDevLogin={showDevLogin} inSheet onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1 overflow-hidden text-small text-ink-muted">
          <li>
            <Link href="/" className="rounded-sm hover:text-ink">
              Home
            </Link>
          </li>
          {crumbs.map((c, i) => (
            <li key={c.href} className="flex min-w-0 items-center gap-1">
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
              {i === crumbs.length - 1 ? (
                <span aria-current="page" className="truncate font-medium text-ink">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="truncate rounded-sm hover:text-ink">
                  {c.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {env !== "prod" ? (
        <span className={cn("rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide", env === "local" ? "border-sev-warn/40 bg-sev-warn-soft text-sev-warn-text" : "border-sev-info/40 bg-sev-info-soft text-sev-info-text")} title="Environment">
          {env}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2" aria-label={`User menu for ${user.userId}`}>
            <UserRound aria-hidden="true" className="h-4 w-4" />
            <span className="hidden font-mono sm:inline">{user.userId}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <span className="block font-mono text-ink">{user.userId}</span>
            <span className="block font-normal text-ink-muted">
              {ROLE_LABELS[user.role]}
              {user.employerId ? ` · Employer ${user.employerId}` : ""}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {showDevLogin ? (
            <DropdownMenuItem asChild>
              <Link href="/login">Switch persona</Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={signOut}>
            <LogOut aria-hidden="true" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}