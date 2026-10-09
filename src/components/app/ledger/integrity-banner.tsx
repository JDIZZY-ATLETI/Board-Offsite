"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDuration, formatInt, formatRelative } from "@/lib/ui/format";
import { INTEGRITY_MAP, TOKEN_CLASSES } from "@/lib/ui/status-map";
import { integrityState } from "@/lib/ui/integrity";
import type { LastVerification } from "@/lib/queries/ledger";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { HashChip } from "./hash-chip";
import type { LedgerHead, VerificationResult } from "@/types";

export interface IntegrityBannerProps {
  head: LedgerHead;
  result: LastVerification | null;
  canVerify: boolean;
  /** Reviewer sees the button disabled with a tooltip; `false` hides it entirely (Submitter). */
  showVerify?: boolean;
  /** Compact strip for the shell (hidden when verified and fresh); `full` for /ledger. */
  variant?: "shell" | "full";
  className?: string;
  onVerified?(result: VerificationResult): void;
}

/** docs/ux-design.md section 4.13. Tampered renders role="alert" and persists at shell level. */
export function IntegrityBanner({ head, result, canVerify, showVerify = true, variant = "full", className, onVerified }: IntegrityBannerProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [local, setLocal] = React.useState<LastVerification | null>(result);
  React.useEffect(() => setLocal(result), [result]);

  const { state, stale } = integrityState(local);
  const entry = INTEGRITY_MAP[state];
  const classes = TOKEN_CLASSES[entry.token];

  if (variant === "shell" && state === "ok" && !stale) return null;
  if (variant === "shell" && state === "unverified" && head.seq === 0) return null;

  const runVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch("/api/ledger/verify", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      const r = (await res.json()) as VerificationResult & { ledgerSeq: number };
      setLocal({ ok: r.ok, checked: r.checked, headSeq: r.headSeq, headHash: r.headHash, verifiedAt: new Date().toISOString(), durationMs: r.durationMs, firstBadSeq: r.firstBadSeq, reason: r.reason, ledgerSeq: r.ledgerSeq, partial: false });
      if (r.ok) toast.success(`Chain verified — ${formatInt(r.checked)} entries OK.`);
      else toast.error(`Integrity failure at #${formatInt(r.firstBadSeq ?? 0)}.`, { duration: Infinity });
      onVerified?.(r);
      router.refresh();
    } catch (e) {
      toast.error("Verification couldn't run", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setVerifying(false);
    }
  };

  const Icon = verifying ? LoaderCircle : entry.icon;
  const isShell = variant === "shell";
  const tone = verifying ? TOKEN_CLASSES.brand : state === "ok" && stale ? TOKEN_CLASSES.unverified : classes;
  const testState = verifying ? "verifying" : state === "ok" ? (stale ? "stale" : "verified") : state;

  const verifyButton = showVerify ? (
    canVerify ? (
      <Button size="sm" variant={state === "tampered" ? "destructive" : "outline"} onClick={() => setConfirmOpen(true)} disabled={verifying || head.seq === 0} data-testid="verify-button">
        <ShieldCheck aria-hidden="true" />
        {state === "ok" ? "Verify again" : "Verify integrity"}
      </Button>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            <Button size="sm" variant="outline" disabled aria-disabled="true" data-testid="verify-button">
              <ShieldCheck aria-hidden="true" />
              Verify integrity
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Admins can run verification</TooltipContent>
      </Tooltip>
    )
  ) : null;

  return (
    <div
      role={state === "tampered" ? "alert" : "status"}
      aria-live={state === "tampered" ? undefined : "polite"}
      data-testid={`integrity-banner-${testState}`}
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border text-small", isShell ? "border-x-0 border-t-0 px-6 py-2" : "rounded-md px-4 py-3", tone.soft, tone.text, tone.border, className)}
    >
      <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", verifying && "motion-safe:animate-spin")} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {verifying ? (
          <span className="font-medium">Verifying {formatInt(head.seq)} entries…</span>
        ) : state === "tampered" && local ? (
          <>
            <span className="font-medium">
              Integrity failure at entry #{formatInt(local.firstBadSeq ?? 0)}
              {local.reason ? ` — ${local.reason}` : ""}.
            </span>
            <span>Entries after #{formatInt(local.firstBadSeq ?? 0)} cannot be trusted.</span>
            {local.firstBadSeq ? (
              <Link href={`/ledger?seq=${local.firstBadSeq}`} className="font-medium underline underline-offset-2">
                Open entry #{formatInt(local.firstBadSeq)}
              </Link>
            ) : null}
          </>
        ) : state === "ok" && local ? (
          <>
            <span className="font-medium">{stale ? `Last verified ${formatRelative(local.verifiedAt)}` : "Chain verified"}</span>
            <span className="tabular-nums">{formatInt(local.checked)} entries</span>
            <HashChip hash={local.headHash} label="head" />
            <time dateTime={local.verifiedAt} title={local.verifiedAt}>
              {formatDateTime(local.verifiedAt)}
            </time>
            {local.durationMs !== null ? <span>{formatDuration(local.durationMs)}</span> : null}
            {local.headSeq !== head.seq ? <span className="text-ink-muted">({formatInt(head.seq - local.headSeq)} entries written since)</span> : null}
          </>
        ) : (
          <>
            <span className="font-medium">Ledger not verified yet</span>
            <span className="tabular-nums">{formatInt(head.seq)} entries</span>
            {head.seq > 0 ? <HashChip hash={head.hash} label="head" /> : null}
          </>
        )}
      </div>
      {verifyButton}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Verify the whole ledger?"
        body={<p>Checks all {formatInt(head.seq)} entries against their hashes. The result is appended to the ledger.</p>}
        confirmLabel="Verify"
        onConfirm={runVerify}
        data-testid="verify-dialog"
      />
    </div>
  );
}