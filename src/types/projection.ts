import type { EventType, IsoDate } from "./events";
import type { LedgerEventType } from "./ledger";

/** Architecture section 4.5. Rebuildable fold over the ledger (section 10.2 `projections`). */
export interface MemberTimelineEntry {
  seq: number;
  streamSeq: number;
  entryId: string;
  eventType: LedgerEventType;
  batchId: string | null;
  actor: string;
  occurredAt: string;
  summary: string;
  /** Set when a CorrectionAppended points at this entry. */
  supersededBySeq?: number;
}

export interface MemberProjection {
  sinPseudo: string;
  sinMasked: string;
  lastName: string | null;
  firstName: string | null;
  employerIds: string[];
  latestEvent: { type: EventType; eventDate: IsoDate; batchId: string; lineNumber: number; seq: number } | null;
  /** Membership status after the latest proposed update set (D-NCT), or null when none proposed. */
  arielStatus: { status: string; subStatus: string | null; effectiveDate: IsoDate; previousStatus: string | null; previousSubStatus: string | null; state: "PROPOSED" | "APPROVED" | "EXPORTED" | "REJECTED" } | null;
  pendingItems: number;
  exportedItems: number;
  corrections: number;
  lastUpdateSet: { updateSetId: string; batchId: string; status: string; itemCount: number; contentHash: string } | null;
  lastEventType: LedgerEventType | null;
  counts: Record<string, number>;
  lastLedgerSeq: number;
  streamHeadHash: string;
  timeline: MemberTimelineEntry[];
  updatedAt: string;
}