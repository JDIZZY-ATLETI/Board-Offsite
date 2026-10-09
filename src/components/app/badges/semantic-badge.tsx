import * as React from "react";
import { cn } from "@/lib/utils";
import { TOKEN_CLASSES, type SemanticEntry } from "@/lib/ui/status-map";

export interface SemanticBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  entry: SemanticEntry;
  /** Enum value for support staff (`title`). */
  value: string;
  size?: "sm" | "md";
  showIcon?: boolean;
  /** Animated dot for auto-advancing states (motion-safe only). */
  pulse?: boolean;
  label?: React.ReactNode;
}

/** Icon + text always (P7). Colours resolve through status-map tokens only (P4). */
export const SemanticBadge = React.forwardRef<HTMLSpanElement, SemanticBadgeProps>(({ entry, value, size = "md", showIcon = true, pulse = false, label, className, ...props }, ref) => {
  const Icon = entry.icon;
  const classes = TOKEN_CLASSES[entry.token];
  return (
    <span
      ref={ref}
      title={value}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm font-medium", classes.badge, size === "sm" ? "px-1.5 py-0 text-caption" : "px-2 py-0.5 text-caption", className)}
      {...props}
    >
      {pulse ? <span aria-hidden="true" className={cn("h-2 w-2 rounded-full motion-safe:animate-pulse-dot", classes.solid)} /> : null}
      {showIcon ? <Icon aria-hidden="true" className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} /> : null}
      <span>{label ?? entry.label}</span>
    </span>
  );
});
SemanticBadge.displayName = "SemanticBadge";