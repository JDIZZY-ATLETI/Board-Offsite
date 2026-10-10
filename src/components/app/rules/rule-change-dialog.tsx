"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/app/alert";
import type { RuleCatalogueItem } from "@/lib/queries/rules";

export type RuleChange = { kind: "enabled"; rule: RuleCatalogueItem; enabled: boolean } | { kind: "tolerances"; rule: RuleCatalogueItem } | { kind: "reset"; rule: RuleCatalogueItem };

export interface RuleChangeDialogProps {
  change: RuleChange | null;
  onClose(): void;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

const ERROR_COPY: Record<string, string> = {
  INVALID_TOLERANCE: "That value is outside the allowed range.",
  UNKNOWN_TOLERANCE: "That key is not a tolerance of this rule.",
  FORBIDDEN: "Only an Admin can change the rules configuration.",
  NOT_FOUND: "This rule no longer exists in the registry.",
};

/**
 * docs/ux-design.md section 5.9 / 7.5 "Rules config save": every change needs a reason and is ledgered on the
 * `system` stream; the new config applies to batches received from now on.
 */
export function RuleChangeDialog({ change, onClose }: RuleChangeDialogProps) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const open = change !== null;

  React.useEffect(() => {
    if (!change) return;
    setReason("");
    setError(null);
    setBusy(false);
    setValues(change.kind === "tolerances" ? Object.fromEntries(change.rule.tolerances.map((t) => [t.key, t.value === null ? "" : String(t.value)])) : {});
  }, [change]);

  if (!change) return null;
  const rule = change.rule;
  const title = change.kind === "enabled" ? `${change.enabled ? "Enable" : "Disable"} rule ${rule.id}?` : change.kind === "tolerances" ? `Edit tolerances for ${rule.id}` : `Reset ${rule.id} to the file defaults?`;
  const valid = reason.trim().length >= 3 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !change) return;
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (change.kind === "reset") {
        res = await fetch(`/api/rules/${encodeURIComponent(rule.id)}?reason=${encodeURIComponent(reason.trim())}`, { method: "DELETE" });
      } else {
        const body: Record<string, unknown> = { reason: reason.trim() };
        if (change.kind === "enabled") body.enabled = change.enabled;
        else {
          const tolerances: Record<string, number | string> = {};
          for (const t of rule.tolerances) {
            const raw = (values[t.key] ?? "").trim();
            if (raw === "" || raw === String(t.value ?? "")) continue;
            if (t.type === "number") {
              const n = Number(raw);
              if (!Number.isFinite(n)) {
                setError(`${t.key} must be a number.`);
                setBusy(false);
                return;
              }
              tolerances[t.key] = n;
            } else tolerances[t.key] = raw;
          }
          if (Object.keys(tolerances).length === 0) {
            setError("No tolerance was changed.");
            setBusy(false);
            return;
          }
          body.tolerances = tolerances;
        }
        res = await fetch(`/api/rules/${encodeURIComponent(rule.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      }
      const payload = (await res.json().catch(() => ({}))) as ApiErrorBody & { config?: { hash: string }; changes?: unknown[]; ledgerSeq?: number | null };
      if (!res.ok) {
        const code = payload.error?.code;
        setError(`${code ? (ERROR_COPY[code] ?? code) + " " : ""}${payload.error?.message ?? `HTTP ${res.status}`}`.trim());
        return;
      }
      const hash = payload.config?.hash ?? "";
      if (payload.ledgerSeq === null && change.kind !== "reset") toast.info("No change - the configuration already had these values.");
      else toast.success(`Configuration saved · hash ${hash.slice(0, 4)}…${hash.slice(-4)}. Applies to batches received from now on.`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? `Network error: ${err.message}` : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-testid={change.kind === "tolerances" ? "tolerance-dialog" : "rule-change-dialog"} className="sm:max-w-[520px]">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {change.kind === "enabled"
                ? `${rule.label} · ${rule.messageId}. The new configuration applies to batches received from now on; validated batches keep the hash they were checked with.`
                : change.kind === "tolerances"
                  ? "Units and spec defaults are shown beside each key. Out-of-range values are rejected by the server. Applies to new batches only."
                  : "Removes every Admin override for this rule (enabled flag and tolerances) so the file defaults apply to new batches."}
            </DialogDescription>
          </DialogHeader>
          {change.kind === "tolerances" ? (
            <div className="space-y-3" data-testid="tolerance-inputs">
              {rule.tolerances.map((t) => {
                const id = `tol-${t.key.replace(/\W/g, "-")}`;
                return (
                  <div key={t.key} className="grid grid-cols-[1fr_9rem] items-center gap-3">
                    <Label htmlFor={id} className="font-mono text-small">
                      {t.key}
                      <span className="ml-2 font-sans text-caption font-normal text-ink-muted">
                        {t.unit}
                        {t.min !== undefined || t.max !== undefined ? ` · ${t.min ?? "−∞"} to ${t.max ?? "∞"}` : ""}
                        {t.note ? ` · ${t.note}` : ""}
                      </span>
                    </Label>
                    <Input id={id} value={values[t.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [t.key]: e.target.value }))} inputMode={t.type === "number" ? "decimal" : "text"} placeholder={t.type === "string" ? "MM-DD" : ""} className="text-right font-mono tabular-nums" />
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="rule-change-reason">Reason for the change log (required)</Label>
            <Input id="rule-change-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoComplete="off" data-testid="rule-change-reason" />
          </div>
          {error ? (
            <Alert variant="error" title="Not saved">
              {error}
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid} variant={change.kind === "reset" ? "destructive" : "default"} data-testid="rule-change-confirm">
              {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              {change.kind === "enabled" ? (change.enabled ? "Enable rule" : "Disable rule") : change.kind === "tolerances" ? "Save tolerances" : "Reset to file"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}