import * as React from "react";
import type { NavGroup } from "@/lib/ui/nav";
import type { Role } from "@/types";
import { SidebarNav } from "./sidebar-nav";
import { TopBar } from "./top-bar";

export interface AppShellProps {
  user: { userId: string; role: Role; employerId: string | null };
  nav: NavGroup[];
  env: "local" | "dev" | "prod";
  /** Shell-level banner slot (global IntegrityBanner). */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

/** docs/ux-design.md section 4.1. Server component; nav is pre-filtered by role on the server. */
export function AppShell({ user, nav, env, banner, children }: AppShellProps) {
  const showDevLogin = env !== "prod";
  return (
    <div data-testid="app-shell" className="flex min-h-screen bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-brand focus:px-3 focus:py-2 focus:text-white">
        Skip to main content
      </a>
      <aside className="sticky top-0 hidden h-screen shrink-0 border-r border-border lg:block" aria-label="Sidebar">
        <SidebarNav nav={nav} user={user} showDevLogin={showDevLogin} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} env={env} nav={nav} showDevLogin={showDevLogin} />
        {banner}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
        <footer className="border-t border-border px-6 py-3 text-caption text-ink-faint">HOOPP Events Validation Ledger · dates ISO · times local (24 h) · SINs masked</footer>
      </div>
    </div>
  );
}