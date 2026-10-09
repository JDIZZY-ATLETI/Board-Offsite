import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-9 w-full rounded-sm border border-border bg-surface-raised px-3 py-1 text-body text-ink shadow-none placeholder:text-ink-faint focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-body file:font-medium",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };