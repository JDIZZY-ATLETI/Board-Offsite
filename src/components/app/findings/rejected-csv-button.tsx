"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { formatInt } from "@/lib/ui/format";

export interface RejectedCsvDialogProps {
  batchId: string;
  rejectedRows: number;
  open: boolean;
  onOpenChange(open: boolean): void;
}

/** Decision D9: the Rejected rows CSV (full SINs) needs a confirmation; the download is audit-logged server-side. */
export function RejectedCsvDialog({ batchId, rejectedRows, open, onOpenChange }: RejectedCsvDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Download rejected rows?"
      body={
        <p>
          This CSV contains full SINs for {formatInt(rejectedRows)} rejected row{rejectedRows === 1 ? "" : "s"}. The download is logged. Keep the file on approved systems only.
        </p>
      }
      confirmLabel="Download CSV"
      onConfirm={() => {
        const a = document.createElement("a");
        a.href = `/api/batches/${batchId}/rejected.csv`;
        a.rel = "noopener";
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }}
      data-testid="rejected-csv-dialog"
    />
  );
}

export interface RejectedCsvButtonProps {
  batchId: string;
  rejectedRows: number;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

export function RejectedCsvButton({ batchId, rejectedRows, variant = "outline", size = "sm", className }: RejectedCsvButtonProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)} data-testid="download-rejected-button">
        <Download aria-hidden="true" /> Download rejected rows (CSV)
      </Button>
      <RejectedCsvDialog batchId={batchId} rejectedRows={rejectedRows} open={open} onOpenChange={setOpen} />
    </>
  );
}