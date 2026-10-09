import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requirePageSession } from "@/lib/auth/page-session";
import { ROLE_LABELS } from "@/lib/ui/nav";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Access denied" };

/** 403 landing (docs/ux-design.md section 5.11): role note + way back (P5). */
export default async function ForbiddenPage() {
  const s = await requirePageSession();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <ShieldAlert aria-hidden="true" className="h-10 w-10 text-ink-faint" strokeWidth={1.5} />
      <h1 className="text-h1">You don&apos;t have access to this page</h1>
      <p className="text-body text-ink-muted">
        You are signed in as <span className="font-mono">{s.userId}</span> ({ROLE_LABELS[s.role]}). Reviewer and Admin roles can open audit pages; ask an administrator if you need access.
      </p>
      <Button asChild>
        <Link href="/">Back to Dashboard</Link>
      </Button>
    </div>
  );
}