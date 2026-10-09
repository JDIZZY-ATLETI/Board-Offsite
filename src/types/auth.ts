export const ROLES = ["EmployerSubmitter", "Reviewer", "Admin"] as const;
export type Role = (typeof ROLES)[number];

export interface Session {
  userId: string;
  role: Role;
  /** Required for EmployerSubmitter; optional context for others. */
  employerId: string | null;
  /** Actor string used in ledger entries and audit log: "user:<id>". */
  actor: string;
}
