import type { Role, Session } from "@/types";

export const ROLE_MATRIX = {
  upload: ["EmployerSubmitter", "Admin"] as Role[],
  viewBatches: ["EmployerSubmitter", "Reviewer", "Admin"] as Role[],
  viewPrivateFindings: ["Reviewer", "Admin"] as Role[],
  downloadRejected: ["EmployerSubmitter", "Reviewer", "Admin"] as Role[],
  readLedger: ["Reviewer", "Admin"] as Role[],
  verifyLedger: ["Admin"] as Role[],
  overrideWarning: ["Reviewer", "Admin"] as Role[],
} as const;

export type Capability = keyof typeof ROLE_MATRIX;

export function hasCapability(role: Role, cap: Capability): boolean {
  return (ROLE_MATRIX[cap] as readonly Role[]).includes(role);
}

/** Submitters only ever see their own employer; Reviewer/Admin are unscoped (null). */
export function employerScope(session: Session): string | null {
  return session.role === "EmployerSubmitter" ? session.employerId : null;
}

export function canAccessEmployer(session: Session, employerId: string): boolean {
  const scope = employerScope(session);
  return scope === null || scope === employerId;
}

export function canViewPrivateFindings(session: Session): boolean {
  return hasCapability(session.role, "viewPrivateFindings");
}
