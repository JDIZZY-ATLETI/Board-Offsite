"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface CopyButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
  label?: string;
  size?: "xs" | "sm";
}

/** Clipboard copy with a transient check icon. Always labelled for AT. */
export const CopyButton = React.forwardRef<HTMLButtonElement, CopyButtonProps>(({ value, label = "Copy", size = "xs", className, disabled, ...props }, ref) => {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const onClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };
  const Icon = copied ? Check : Copy;
  return (
    <button
      ref={ref}
      type="button"
      aria-label={copied ? "Copied" : label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40", size === "xs" ? "h-6 w-6" : "h-8 w-8", className)}
      {...props}
    >
      <Icon aria-hidden="true" className={cn(size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4", copied && "text-ok")} />
    </button>
  );
});
CopyButton.displayName = "CopyButton";