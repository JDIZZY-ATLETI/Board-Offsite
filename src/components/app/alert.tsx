import * as React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertVariant = "info" | "success" | "warning" | "error";

const STYLES: Record<AlertVariant, { box: string; icon: React.ElementType; iconClass: string }> = {
  info: { box: "border-sev-info/30 bg-sev-info-soft text-sev-info-text", icon: Info, iconClass: "text-sev-info" },
  success: { box: "border-ok/30 bg-ok-soft text-ok-text", icon: CircleCheck, iconClass: "text-ok" },
  warning: { box: "border-sev-warn/30 bg-sev-warn-soft text-sev-warn-text", icon: TriangleAlert, iconClass: "text-sev-warn" },
  error: { box: "border-sev-cme/30 bg-sev-cme-soft text-sev-cme-text", icon: CircleAlert, iconClass: "text-sev-cme" },
};

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: AlertVariant;
  title?: React.ReactNode;
  actions?: React.ReactNode;
}

/** Inline alert (docs/ux-design.md section 4.17). Errors use role="alert"; others role="status". */
export function Alert({ variant = "info", title, actions, className, children, ...props }: AlertProps) {
  const s = STYLES[variant];
  const Icon = s.icon;
  return (
    <div role={variant === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-md border p-4 text-body", s.box, className)} {...props}>
      <Icon aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0", s.iconClass)} />
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-body [&_code]:rounded-sm [&_code]:bg-background/60 [&_code]:px-1 [&_code]:font-mono [&_code]:text-small">{children}</div> : null}
        {actions ? <div className="flex flex-wrap gap-2 pt-2">{actions}</div> : null}
      </div>
    </div>
  );
}