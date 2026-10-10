"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/ui/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Alert } from "@/components/app/alert";
import type { RecordOutcome, ValidationFinding } from "@/types";
import { FindingCard, type FindingRecordSummary } from "./finding-card";

export interface OverrideTarget {
  finding: ValidationFinding;
  record?: FindingRecordSummary | null;
}

export interface OverrideDrawerProps {
  batchId: string;
  /** One finding = single override; several (same rule) = bulk, one reason for all. */
  targets: OverrideTarget[];
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Called after at least one override was recorded (the caller may clear its selection). */
  onRecorded?(result: { applied: number; failed: number; heldRemaining: number | null }): void;
  /** Test seam: default reads GET /api/rules/{ruleId}. */
  loadReasons?: (ruleId: string) => Promise<string[]>;
}

export const OVERRIDE_ERROR_COPY: Record<string, string> = {
  REASON_NOT_ALLOWED: "That reason is not one this rule allows. Choose a reason from the list.",
  NOTE_REQUIRED: "Add a short explanation for an \u201cOther\u201d reason.",
  NOT_OVERRIDABLE: "Only warnings can be overridden.",
  BATCH_NOT_VALIDATED: "Overrides are only possible while the batch is Validated. This batch has moved on \u2014 reload to see its current state.",
  ALREADY_OVERRIDDEN: "This warning already has an override. Reload to see who recorded it.",
  ROW_REJECTED: "This row is rejected by a member error, so overriding the warning would not change its outcome. The employer must correct the file and upload again.",
  FORBIDDEN: "Warning overrides are recorded by a HOOPP reviewer.",
  NOT_FOUND: "This finding no longer exists. Reload the page.",
  NO_OVERRIDE_APPLIED: "None of the selected warnings could be overridden.",
};

/** Maps an API error code to the docs/ux-design.md section 7 copy; unknown codes fall back to the server message. */
export function overrideErrorCopy(code: string | undefined, fallback: string): string {
  return (code && OVERRIDE_ERROR_COPY[code]) || fallback || "Something went wrong recording the override.";
}

export function isOtherReason(reason: string): boolean {
  return /^other\b/i.test(reason);
}

async function defaultLoadReasons(ruleId: string): Promise<string[]> {
  const r = await fetch(`/api/rules/${encodeURIComponent(ruleId)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { rule: { overrideReasons: string[] } };
  return body.rule.overrideReasons;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

type BulkItem = { findingId: string; ok: true; rowOutcome: RecordOutcome; ledgerSeq: number } | { findingId: string; ok: false; status: number; code: string; message: string };

/**
 * docs/ux-design.md section 4.9 / 6.4 / 7.5 "Record override". Reasons are the rule's list verbatim; "Other" needs a
 * note; posts to the batch-scoped override route (bulk when several findings are selected) and refreshes the page.
 */
export function OverrideDrawer({ batchId, targets, open, onOpenChange, onRecorded, loadReasons = defaultLoadReasons }: OverrideDrawerProps) {
  const router = useRouter();
  const first = targets[0];
  const ruleId = first?.finding.ruleId ?? null;
  const bulk = targets.length > 1;
  const [reasons, setReasons] = React.useState<string[] | null>(null);
  const [reason, setReason] = React.useState<string>("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [itemErrors, setItemErrors] = React.useState<Array<{ finding: ValidationFinding; message: string }>>([]);
  const noteId = React.useId();
  const errorId = React.useId();

  React.useEffect(() => {
    if (!open || !ruleId) return;
    let cancelled = false;
    setReasons(null);
    setReason("");
    setNote("");
    setError(null);
    setItemErrors([]);
    loadReasons(ruleId)
      .then((list) => !cancelled && setReasons(list))
      .catch(() => !cancelled && setReasons(first?.finding.overrideReasons ?? []));
    return () => {
      cancelled = true;
    };
  }, [open, ruleId, first, loadReasons]);

  const needsNote = isOtherReason(reason);
  const noteMissing = needsNote && note.trim() === "";
  const canSubmit = Boolean(reason) && !noteMissing && !busy && targets.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setItemErrors([]);
    const payloadNote = note.trim() ? note.trim() : undefined;
    try {
      if (!bulk) {
        const f = targets[0].finding;
        const res = await fetch(`/api/batches/${batchId}/findings/${f.findingId}/override`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason, ...(payloadNote ? { note: payloadNote } : {}) }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
          setError(overrideErrorCopy(body.error?.code, body.error?.message ?? `HTTP ${res.status}`));
          return;
        }
        const body = (await res.json()) as { rowOutcome: RecordOutcome; heldRemaining: number };
        const row = f.lineNumber ? `Row ${formatInt(f.lineNumber)}` : "The row";
        toast.success(body.rowOutcome === "ACCEPTED" ? `Override recorded. ${row} is now accepted.` : body.rowOutcome === "HELD" ? `Override recorded. ${row} still has another warning pending.` : `Override recorded.`);
        onRecorded?.({ applied: 1, failed: 0, heldRemaining: body.heldRemaining });
        onOpenChange(false);
        router.refresh();
        return;
      }
      const res = await fetch(`/api/batches/${batchId}/findings/override`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingIds: targets.map((t) => t.finding.findingId), reason, ...(payloadNote ? { note: payloadNote } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiErrorBody & { results?: BulkItem[]; heldRemaining?: number };
      if (res.status !== 200 && res.status !== 207) {
        setError(overrideErrorCopy(body.error?.code, body.error?.message ?? `HTTP ${res.status}`));
        return;
      }
      const results = body.results ?? [];
      const failed = results.filter((r): r is Extract<BulkItem, { ok: false }> => !r.ok);
      const applied = results.length - failed.length;
      const byId = new Map(targets.map((t) => [t.finding.findingId, t.finding]));
      setItemErrors(failed.map((r) => ({ finding: byId.get(r.findingId)!, message: overrideErrorCopy(r.code, r.message) })));
      onRecorded?.({ applied, failed: failed.length, heldRemaining: body.heldRemaining ?? null });
      if (failed.length === 0) {
        toast.success(`${formatInt(applied)} override${applied === 1 ? "" : "s"} recorded.`);
        onOpenChange(false);
      } else {
        toast.warning(`${formatInt(applied)} of ${formatInt(results.length)} overrides recorded. ${formatInt(failed.length)} could not be applied.`);
        setError(`${formatInt(failed.length)} of ${formatInt(results.length)} overrides were not applied. The others are recorded.`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? `Network error: ${err.message}` : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const title = bulk ? `Record override for ${formatInt(targets.length)} warnings` : "Record override";
  const lines = targets.map((t) => t.finding.lineNumber).filter((n): n is number => typeof n === "number");

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-[480px]" data-testid="override-drawer">
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>Choose the reason that applies. It appears in the Summary of Validations and on the ledger with your name.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 px-6 py-4">
            {!bulk && first ? (
              <FindingCard finding={first.finding} record={first.record} compact />
            ) : first ? (
              <div className="rounded-md border border-held/40 bg-held-soft/30 p-3 text-small">
                <p className="font-medium text-ink">
                  Rule <span className="font-mono">{ruleId}</span> on rows {lines.map((n) => `#${n}`).join(", ")}
                </p>
                <p className="mt-1 text-ink-muted">One reason applies to every selected warning. Each override is recorded separately on the ledger.</p>
              </div>
            ) : null}

            <fieldset className="space-y-2" aria-describedby={error ? errorId : undefined}>
              <legend className="text-small font-medium text-ink">
                Override reason <span className="text-ink-muted">(required)</span>
              </legend>
              {reasons === null ? (
                <p className="inline-flex items-center gap-2 text-small text-ink-muted" role="status">
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading the rule&apos;s reasons…
                </p>
              ) : reasons.length === 0 ? (
                <p className="text-small text-ink-muted">This rule lists no override reasons.</p>
              ) : (
                <ul className="space-y-1.5" data-testid="override-reasons">
                  {reasons.map((r, i) => {
                    const id = `override-reason-${i}`;
                    return (
                      <li key={r} className={cn("rounded-sm border px-3 py-2", reason === r ? "border-brand bg-brand-soft/40" : "border-border")}>
                        <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-small text-ink">
                          <input id={id} type="radio" name="override-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="mt-0.5 h-4 w-4 border-border text-brand focus:ring-brand" />
                          <span>{r}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor={noteId}>
                Note {needsNote ? <span className="text-ink-muted">(required for an &ldquo;Other&rdquo; reason)</span> : <span className="text-ink-muted">(optional)</span>}
              </Label>
              <textarea
                id={noteId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={500}
                required={needsNote}
                aria-invalid={noteMissing && reason ? true : undefined}
                aria-describedby={`${noteId}-help`}
                className="flex w-full rounded-sm border border-border bg-surface-raised px-3 py-2 text-body text-ink placeholder:text-ink-faint focus-visible:border-brand"
                placeholder={needsNote ? "Explain why this value is correct" : "Context for the reviewer trail"}
                data-testid="override-note"
              />
              <p id={`${noteId}-help`} className="text-caption text-ink-muted">
                {noteMissing && reason ? "A note is required when the reason is \u201cOther\u201d." : "Up to 500 characters."}
              </p>
            </div>

            <p className="inline-flex items-start gap-2 rounded-sm bg-surface p-3 text-caption text-ink-muted">
              <Lock aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-medium text-ink">Who will see this:</span> the override is written to the ledger (WarningOverridden) and listed in the Summary of Validations with your user id and the time.
              </span>
            </p>

            {error ? (
              <div id={errorId}>
                <Alert variant="error" title="Override not recorded" role="alert">
                  {error}
                  {itemErrors.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="override-item-errors">
                      {itemErrors.map((x) => (
                        <li key={x.finding.findingId}>
                          Row {x.finding.lineNumber ?? "?"}: {x.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Alert>
              </div>
            ) : null}
          </div>
          <SheetFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="override-submit">
              {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              {bulk ? `Record ${formatInt(targets.length)} overrides` : "Record override"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}