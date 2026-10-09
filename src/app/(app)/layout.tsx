import type { ReactNode } from "react";
import { getAppContext } from "@/lib/app-context";
import { appEnv, requirePageSession } from "@/lib/auth/page-session";
import { getLastVerification, getLedgerHead } from "@/lib/queries/ledger";
import { navForRole } from "@/lib/ui/nav";
import { AppShell } from "@/components/app/app-shell";
import { IntegrityBanner } from "@/components/app/ledger/integrity-banner";

export const dynamic = "force-dynamic";

/** Authenticated shell (docs/ux-design.md section 9.1): session -> role-filtered nav -> global IntegrityBanner. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession();
  const ctx = await getAppContext();
  const [head, last] = await Promise.all([getLedgerHead(ctx), getLastVerification(ctx)]);
  const env = appEnv();
  return (
    <AppShell
      user={{ userId: session.userId, role: session.role, employerId: session.employerId }}
      nav={navForRole(session.role)}
      env={env}
      banner={<IntegrityBanner variant="shell" head={head} result={last} canVerify={session.role === "Admin"} showVerify={session.role !== "EmployerSubmitter"} />}
    >
      {children}
    </AppShell>
  );
}