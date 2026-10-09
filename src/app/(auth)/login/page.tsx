import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { DEV_PERSONAS } from "@/lib/auth/dev-session";
import { getPageSession } from "@/lib/auth/page-session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Dev login" };
export const dynamic = "force-dynamic";

/** docs/ux-design.md section 5.10. Hidden in production builds. */
export default async function LoginPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const current = await getPageSession();
  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-brand text-white">
            <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-h1">HOOPP Events Ledger</h1>
            <p className="text-small text-ink-muted">Dev login · header auth provider · <span className="font-mono">LOCAL</span></p>
          </div>
        </div>
        <LoginForm personas={DEV_PERSONAS} current={current ? { userId: current.userId, role: current.role, employerId: current.employerId } : null} />
        <p className="text-caption text-ink-faint">
          This page sets an <code className="font-mono">httpOnly</code> cookie that the middleware maps to <code className="font-mono">x-user-id</code> / <code className="font-mono">x-user-role</code> / <code className="font-mono">x-employer-id</code>. Production replaces this with Entra ID (architecture §16).
        </p>
      </div>
    </main>
  );
}