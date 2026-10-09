import {
  BadgeCheck,
  Ban,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CirclePlus,
  CircleX,
  FileText,
  FileX,
  Flag,
  Hourglass,
  Inbox,
  Info,
  Layers,
  Link2,
  PackageCheck,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestionMark,
  ShieldX,
  SquareX,
  Trash,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { BatchStatus, FindingSeverity, RecordOutcome } from "@/types";

/**
 * Single source of truth for the UI state language (docs/ux-design.md section 3.3).
 * Every badge, stepper node, KPI tint and chart legend resolves through this module.
 */

export type ColourToken =
  | "sev-file"
  | "sev-cme"
  | "sev-warn"
  | "sev-info"
  | "ok"
  | "held"
  | "rejected"
  | "st-transient"
  | "st-attention"
  | "st-ok"
  | "st-bad"
  | "verified"
  | "tampered"
  | "unverified"
  | "brand"
  | "diff-add"
  | "diff-del";

export interface SemanticEntry {
  label: string;
  token: ColourToken;
  icon: LucideIcon;
}

/** Tailwind classes per colour token: badge fill (soft background + text) and solid indicator. */
export const TOKEN_CLASSES: Record<ColourToken, { badge: string; solid: string; text: string; soft: string; border: string }> = {
  "sev-file": { badge: "bg-sev-file-soft text-sev-file-text", solid: "bg-sev-file", text: "text-sev-file-text", soft: "bg-sev-file-soft", border: "border-sev-file/40" },
  "sev-cme": { badge: "bg-sev-cme-soft text-sev-cme-text", solid: "bg-sev-cme", text: "text-sev-cme-text", soft: "bg-sev-cme-soft", border: "border-sev-cme/40" },
  "sev-warn": { badge: "bg-sev-warn-soft text-sev-warn-text", solid: "bg-sev-warn", text: "text-sev-warn-text", soft: "bg-sev-warn-soft", border: "border-sev-warn/40" },
  "sev-info": { badge: "bg-sev-info-soft text-sev-info-text", solid: "bg-sev-info", text: "text-sev-info-text", soft: "bg-sev-info-soft", border: "border-sev-info/40" },
  ok: { badge: "bg-ok-soft text-ok-text", solid: "bg-ok", text: "text-ok-text", soft: "bg-ok-soft", border: "border-ok/40" },
  held: { badge: "bg-held-soft text-held-text", solid: "bg-held", text: "text-held-text", soft: "bg-held-soft", border: "border-held/40" },
  rejected: { badge: "bg-rejected-soft text-rejected-text", solid: "bg-rejected", text: "text-rejected-text", soft: "bg-rejected-soft", border: "border-rejected/40" },
  "st-transient": { badge: "bg-brand-soft text-brand", solid: "bg-st-transient", text: "text-st-transient", soft: "bg-brand-soft", border: "border-st-transient/40" },
  "st-attention": { badge: "bg-sev-warn-soft text-sev-warn-text", solid: "bg-st-attention", text: "text-sev-warn-text", soft: "bg-sev-warn-soft", border: "border-st-attention/40" },
  "st-ok": { badge: "bg-ok-soft text-ok-text", solid: "bg-st-ok", text: "text-ok-text", soft: "bg-ok-soft", border: "border-st-ok/40" },
  "st-bad": { badge: "bg-sev-cme-soft text-sev-cme-text", solid: "bg-st-bad", text: "text-sev-cme-text", soft: "bg-sev-cme-soft", border: "border-st-bad/40" },
  verified: { badge: "bg-verified-soft text-verified-text", solid: "bg-verified", text: "text-verified-text", soft: "bg-verified-soft", border: "border-verified/40" },
  tampered: { badge: "bg-tampered-soft text-tampered-text", solid: "bg-tampered", text: "text-tampered-text", soft: "bg-tampered-soft", border: "border-tampered/40" },
  unverified: { badge: "bg-surface text-ink-muted", solid: "bg-unverified", text: "text-ink-muted", soft: "bg-surface", border: "border-border" },
  brand: { badge: "bg-brand-soft text-brand", solid: "bg-brand", text: "text-brand", soft: "bg-brand-soft", border: "border-brand/40" },
  "diff-add": { badge: "bg-diff-add-soft text-ok-text", solid: "bg-diff-add", text: "text-ok-text", soft: "bg-diff-add-soft", border: "border-diff-add/40" },
  "diff-del": { badge: "bg-diff-del-soft text-sev-cme-text", solid: "bg-diff-del", text: "text-sev-cme-text", soft: "bg-diff-del-soft", border: "border-diff-del/40" },
};

export const SEVERITY_MAP: Record<FindingSeverity, SemanticEntry> = {
  FILE_ERROR: { label: "File error", token: "sev-file", icon: FileX },
  COMPLETE_MEMBER_ERROR: { label: "Rejected (member error)", token: "sev-cme", icon: CircleX },
  WARNING: { label: "Warning — override needed", token: "sev-warn", icon: TriangleAlert },
  INFORMATION: { label: "Information", token: "sev-info", icon: Info },
};

/** Short labels for dense contexts (facet chips, counts). */
export const SEVERITY_SHORT: Record<FindingSeverity, string> = {
  FILE_ERROR: "File error",
  COMPLETE_MEMBER_ERROR: "Rejected",
  WARNING: "Warning",
  INFORMATION: "Info",
};

export const OUTCOME_MAP: Record<RecordOutcome, SemanticEntry> = {
  ACCEPTED: { label: "Accepted", token: "ok", icon: CircleCheck },
  HELD: { label: "Held (needs override)", token: "held", icon: CirclePause },
  REJECTED: { label: "Rejected", token: "rejected", icon: CircleX },
};

const BATCH_STATUS_BASE: Record<BatchStatus, SemanticEntry> = {
  RECEIVED: { label: "Received", token: "st-transient", icon: Inbox },
  PARSED: { label: "Parsed", token: "st-transient", icon: FileText },
  VALIDATED: { label: "Validated", token: "st-transient", icon: ShieldCheck },
  LEDGERED: { label: "Written to ledger", token: "st-transient", icon: Link2 },
  PROJECTION_BUILT: { label: "Update Set built", token: "st-transient", icon: Layers },
  PENDING_APPROVAL: { label: "Pending approval", token: "st-attention", icon: Hourglass },
  APPROVED: { label: "Approved", token: "st-ok", icon: BadgeCheck },
  REJECTED: { label: "Rejected by reviewer", token: "st-bad", icon: Ban },
  EXPORTED: { label: "Exported", token: "st-ok", icon: PackageCheck },
  FAILED: { label: "Failed — retry available", token: "st-bad", icon: CircleAlert },
  FILE_REJECTED: { label: "File rejected", token: "st-bad", icon: FileX },
};

/** Statuses that auto-advance and therefore pulse / poll. */
export const TRANSIENT_BATCH_STATUSES: readonly BatchStatus[] = ["RECEIVED", "PARSED", "LEDGERED", "PROJECTION_BUILT"];
/** Statuses after which nothing changes without an explicit action. */
export const TERMINAL_BATCH_STATUSES: readonly BatchStatus[] = ["EXPORTED", "FILE_REJECTED"];

export function isTransientStatus(status: BatchStatus): boolean {
  return TRANSIENT_BATCH_STATUSES.includes(status);
}

export function isTerminalStatus(status: BatchStatus): boolean {
  return TERMINAL_BATCH_STATUSES.includes(status);
}

/** VALIDATED with HELD rows becomes an attention state ("Validated · 3 held"). */
export function batchStatusEntry(status: BatchStatus, heldCount = 0): SemanticEntry {
  const base = BATCH_STATUS_BASE[status];
  if (status === "VALIDATED" && heldCount > 0) {
    return { label: `Validated · ${heldCount} held`, token: "st-attention", icon: ShieldAlert };
  }
  return base;
}

export const BATCH_STATUS_MAP = BATCH_STATUS_BASE;

export type IntegrityState = "ok" | "tampered" | "unverified";

export const INTEGRITY_MAP: Record<IntegrityState, SemanticEntry> = {
  ok: { label: "Verified", token: "verified", icon: ShieldCheck },
  tampered: { label: "Integrity failure", token: "tampered", icon: ShieldX },
  unverified: { label: "Not verified", token: "unverified", icon: ShieldQuestionMark },
};

export type ArielOperation = "CREATE" | "UPDATE" | "UPSERT_ADD" | "CLOSE" | "DELETE" | "SET_FLAG";

export const OPERATION_MAP: Record<ArielOperation, SemanticEntry> = {
  CREATE: { label: "Create", token: "diff-add", icon: Plus },
  UPDATE: { label: "Update", token: "brand", icon: Pencil },
  UPSERT_ADD: { label: "Add to existing", token: "brand", icon: CirclePlus },
  CLOSE: { label: "Close", token: "sev-warn", icon: SquareX },
  DELETE: { label: "Delete", token: "diff-del", icon: Trash },
  SET_FLAG: { label: "Set flag", token: "sev-info", icon: Flag },
};

/** Stepper order (docs/ux-design.md section 4.7). FILE_REJECTED / FAILED / REJECTED are branch nodes. */
export const PIPELINE_STEPS: readonly BatchStatus[] = ["RECEIVED", "PARSED", "VALIDATED", "LEDGERED", "PROJECTION_BUILT", "PENDING_APPROVAL", "APPROVED", "EXPORTED"];