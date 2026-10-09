"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** Must type this exact word to enable confirm (e.g. RESET). */
  typeToConfirm?: string;
  requireReason?: boolean;
  onConfirm(input: { reason?: string }): void | Promise<void>;
  "data-testid"?: string;
}

/** docs/ux-design.md section 4.18. Focus trapped; Esc cancels; confirm disabled until valid. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "default", typeToConfirm, requireReason, onConfirm, ...rest }: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) {
      setTyped("");
      setReason("");
      setBusy(false);
    }
  }, [open]);
  const valid = (!typeToConfirm || typed === typeToConfirm) && (!requireReason || reason.trim().length >= 3);
  const confirm = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onConfirm({ reason: requireReason ? reason.trim() : undefined });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={rest["data-testid"] ?? "confirm-dialog"}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {body ? <AlertDialogDescription asChild><div>{body}</div></AlertDialogDescription> : null}
        </AlertDialogHeader>
        {typeToConfirm ? (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-type">
              Type <code className="font-mono">{typeToConfirm}</code> to confirm (required)
            </Label>
            <Input id="confirm-type" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        ) : null}
        {requireReason ? (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason">Reason (required)</Label>
            <Input id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={!valid || busy} className={cn(tone === "danger" && buttonVariants({ variant: "destructive" }))}>
            {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}