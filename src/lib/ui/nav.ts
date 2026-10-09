import type { Role } from "@/types";

/** Icon keys resolved to lucide components on the client (components are not serialisable across the RSC boundary). */
export type NavIcon = "dashboard" | "upload" | "batches" | "pending" | "ledger" | "members" | "ariel" | "rules" | "roles" | "audit";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  /** Exact-match for "/", prefix match otherwise. */
  match?: "exact" | "prefix";
  /** Items present in the IA but not yet built; rendered disabled with a tooltip. */
  phase?: number;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

interface NavDef extends NavItem {
  roles: Role[];
}

const ALL: Role[] = ["EmployerSubmitter", "Reviewer", "Admin"];
const REVIEW: Role[] = ["Reviewer", "Admin"];
const ADMIN: Role[] = ["Admin"];

/** docs/ux-design.md section 2.2. Hidden items are also server-enforced by `requirePageRole`. */
const NAV: Array<{ label: string | null; items: NavDef[] }> = [
  { label: null, items: [{ label: "Dashboard", href: "/", icon: "dashboard", match: "exact", roles: ALL }] },
  {
    label: "Submit",
    items: [
      { label: "Upload Events file", href: "/upload", icon: "upload", roles: ["EmployerSubmitter", "Admin"] },
      { label: "Batches", href: "/batches", icon: "batches", roles: ALL },
    ],
  },
  {
    label: "Review",
    items: [{ label: "Pending approvals", href: "/batches?status=PENDING_APPROVAL", icon: "pending", roles: REVIEW, match: "exact" }],
  },
  {
    label: "Audit",
    items: [
      { label: "Ledger explorer", href: "/ledger", icon: "ledger", roles: REVIEW },
      { label: "Members", href: "/members", icon: "members", roles: REVIEW, phase: 3 },
      { label: "Mock Ariel", href: "/ariel", icon: "ariel", roles: REVIEW, phase: 2 },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Rules & config", href: "/admin/rules", icon: "rules", roles: REVIEW, phase: 2 },
      { label: "Roles", href: "/admin/roles", icon: "roles", roles: ADMIN, phase: 4 },
      { label: "Audit log", href: "/admin/audit", icon: "audit", roles: ADMIN, phase: 4 },
    ],
  },
];

/** Builds the role-filtered nav on the server so hidden items never reach the client. */
export function navForRole(role: Role): NavGroup[] {
  return NAV.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => i.roles.includes(role)).map(({ roles: _roles, ...item }) => {
      void _roles;
      return item;
    }),
  })).filter((g) => g.items.length > 0);
}

export const ROLE_LABELS: Record<Role, string> = {
  EmployerSubmitter: "Employer Submitter",
  Reviewer: "Reviewer",
  Admin: "Admin",
};