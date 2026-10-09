"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      visibleToasts={3}
      duration={6000}
      closeButton
      toastOptions={{
        classNames: {
          toast: "group border border-border bg-surface-raised text-ink shadow-pop rounded-md",
          description: "text-ink-muted",
          actionButton: "bg-brand text-white",
          cancelButton: "bg-surface text-ink",
          error: "border-sev-cme/40",
          success: "border-ok/40",
        },
      }}
      {...props}
    />
  );
}