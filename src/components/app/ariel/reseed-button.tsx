"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";

/** Admin, dev only (docs/ux-design.md section 5.8 / 7.5 "Reset mock Ariel seed"). Hidden in production by the page. */
export function ReseedButton() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement>(null);
  const router = useRouter();
  return (
    <>
      <Button ref={ref} variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="ariel-reseed-button">
        <RotateCcw aria-hidden="true" /> Reset seed data
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reset mock Ariel data?"
        body="Replaces all mock members with the seed. Type RESET to confirm."
        confirmLabel="Reset data"
        tone="danger"
        typeToConfirm="RESET"
        returnFocusTo={ref}
        data-testid="ariel-reseed-dialog"
        onConfirm={async () => {
          const res = await fetch("/api/ariel/reseed", { method: "POST" });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
            toast.error(body.error?.message ?? `Reseed failed (HTTP ${res.status})`);
            return;
          }
          const body = (await res.json()) as { members?: number };
          toast.success(`Seed restored (${body.members ?? "?"} members).`);
          router.refresh();
        }}
      />
    </>
  );
}