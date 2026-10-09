import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-sm border border-transparent px-2 py-0.5 text-caption font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-brand-soft text-brand",
      neutral: "bg-surface text-ink-muted border-border",
      outline: "text-ink border-border",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };