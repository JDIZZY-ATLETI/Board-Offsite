import { cn } from "@/lib/utils";
import { EMPLOYER_NAMES } from "@/lib/auth/dev-session";
import { ROLE_LABELS } from "@/lib/ui/nav";
import type { Role } from "@/types";

export interface RoleChipProps {
  role: Role;
  employerId?: string | null;
  userId?: string;
  compact?: boolean;
  className?: string;
}

/** `EmployerSubmitter · Employer 0235` (docs/ux-design.md section 2.1). */
export function RoleChip({ role, employerId, userId, compact = false, className }: RoleChipProps) {
  const employer = employerId ? `${employerId}${EMPLOYER_NAMES[employerId] ? ` · ${EMPLOYER_NAMES[employerId]}` : ""}` : null;
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)} data-testid="role-chip" title={`${role}${employerId ? ` / employer ${employerId}` : ""}`}>
      <span className="inline-flex w-fit items-center rounded-sm bg-brand-soft px-1.5 py-0.5 text-caption font-medium text-brand">{compact ? role.replace(/[a-z]/g, "") : ROLE_LABELS[role]}</span>
      {!compact ? (
        <span className="truncate text-caption text-ink-muted">
          {userId ? <span className="font-mono">{userId}</span> : null}
          {userId && employer ? " · " : null}
          {employer ? <span>Employer {employer}</span> : null}
        </span>
      ) : null}
    </div>
  );
}