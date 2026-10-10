import { and, asc, count, eq, gt, inArray, lte } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import type { DbOrTx } from "@/lib/db/client";
import { arielUpdateItems, batches, eventsRecords, ledgerEntries, memberProjections, projectionCheckpoints } from "@/lib/db/schema";
import { rowToEntry } from "@/lib/ledger/service";
import type { ArielUpdateProposedPayload, CorrectionAppendedPayload, LedgerEntry, MemberProjection, MemberRecordRejectedPayload, MemberRecordValidatedPayload, MemberTimelineEntry, UpdateSetBuiltPayload, WarningOverriddenPayload } from "@/types";

export const PROJECTION_NAME = "member_projections";
const PAGE = 1000;
const TIMELINE_CAP = 200;
const SET_PREFIX = "set:";

type State = MemberProjection;

function fresh(sinPseudo: string, sinMasked: string | null): State {
  return {
    sinPseudo,
    sinMasked: sinMasked ?? "***-***-***",
    lastName: null,
    firstName: null,
    employerIds: [],
    latestEvent: null,
    arielStatus: null,
    pendingItems: 0,
    exportedItems: 0,
    corrections: 0,
    lastUpdateSet: null,
    lastEventType: null,
    counts: {},
    lastLedgerSeq: 0,
    streamHeadHash: "0".repeat(64),
    timeline: [],
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

function rowToState(r: typeof memberProjections.$inferSelect): State {
  return {
    sinPseudo: r.sinPseudo,
    sinMasked: r.sinMasked,
    lastName: r.lastName,
    firstName: r.firstName,
    employerIds: r.employerIds,
    latestEvent: r.latestEvent as State["latestEvent"],
    arielStatus: r.arielStatus as State["arielStatus"],
    pendingItems: r.pendingItems,
    exportedItems: r.exportedItems,
    corrections: r.corrections,
    lastUpdateSet: r.lastUpdateSet as State["lastUpdateSet"],
    lastEventType: r.lastEventType as State["lastEventType"],
    counts: r.counts,
    lastLedgerSeq: Number(r.lastLedgerSeq),
    streamHeadHash: r.streamHeadHash,
    timeline: r.timeline as MemberTimelineEntry[],
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

function bump(s: State, key: string, n = 1): void {
  s.counts[key] = (s.counts[key] ?? 0) + n;
}

function recomputePending(s: State): void {
  s.pendingItems = Object.entries(s.counts)
    .filter(([k]) => k.startsWith(SET_PREFIX))
    .reduce((acc, [, v]) => acc + v, 0);
}

function summaryOf(e: LedgerEntry): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.eventType) {
    case "MemberRecordValidated": {
      const v = p as unknown as MemberRecordValidatedPayload;
      const rules = v.findings.map((f) => f.ruleId);
      return `Validated ${v.eventType ?? "?"} ${v.eventDate ?? ""} (line ${v.lineNumber})${rules.length ? `; findings: ${[...new Set(rules)].join(", ")}` : "; no findings"}${v.overrides.length ? `; ${v.overrides.length} override(s)` : ""}`.trim();
    }
    case "MemberRecordRejected": {
      const v = p as unknown as MemberRecordRejectedPayload;
      return `Rejected ${v.eventType ?? "?"} ${v.eventDate ?? ""} (line ${v.lineNumber}): ${[...new Set(v.findings.map((f) => f.ruleId))].join(", ")}`.trim();
    }
    case "WarningOverridden": {
      const v = p as unknown as WarningOverriddenPayload;
      return `${v.ruleId} overridden - ${v.reason}${v.rowOutcome === "ACCEPTED" ? " (row accepted)" : ""}`;
    }
    case "ArielUpdateProposed": {
      const v = p as unknown as ArielUpdateProposedPayload;
      const parts = Object.entries(v.byRecordType).map(([k, n]) => `${k} ${n}`);
      return `${v.itemCount} Ariel update(s) proposed for ${v.eventType ?? "?"} ${v.eventDate ?? ""}: ${parts.join(", ")}`;
    }
    case "CorrectionAppended": {
      const v = p as unknown as CorrectionAppendedPayload;
      return `${v.kind === "RESUBMITTED_PROPOSAL" ? "Resubmission supersedes" : "Correction of rejected row"} ledger #${v.supersedesSeq}`;
    }
    default:
      return e.eventType;
  }
}

class Folder {
  private readonly states = new Map<string, State>();
  private readonly batchEmployer = new Map<string, string | null>();
  private readonly recordNames = new Map<string, { lastName: string | null; firstName: string | null }>();
  constructor(private readonly db: DbOrTx) {}

  touched(): State[] {
    return [...this.states.values()];
  }

  private async state(sinPseudo: string, sinMasked: string | null): Promise<State> {
    let s = this.states.get(sinPseudo);
    if (!s) {
      const [row] = await this.db.select().from(memberProjections).where(eq(memberProjections.sinPseudo, sinPseudo));
      s = row ? rowToState(row) : fresh(sinPseudo, sinMasked);
      this.states.set(sinPseudo, s);
    }
    if (sinMasked && s.sinMasked === "***-***-***") s.sinMasked = sinMasked;
    return s;
  }

  private async employerOf(batchId: string | null): Promise<string | null> {
    if (!batchId) return null;
    if (!this.batchEmployer.has(batchId)) {
      const [b] = await this.db.select({ employerId: batches.employerId }).from(batches).where(eq(batches.batchId, batchId));
      this.batchEmployer.set(batchId, b?.employerId ?? null);
    }
    return this.batchEmployer.get(batchId) ?? null;
  }

  private async namesOf(recordId: string | undefined): Promise<{ lastName: string | null; firstName: string | null } | null> {
    if (!recordId) return null;
    if (!this.recordNames.has(recordId)) {
      const [r] = await this.db.select({ lastName: eventsRecords.lastName, firstName: eventsRecords.firstName }).from(eventsRecords).where(eq(eventsRecords.recordId, recordId));
      this.recordNames.set(recordId, r ? { lastName: r.lastName, firstName: r.firstName } : { lastName: null, firstName: null });
    }
    return this.recordNames.get(recordId)!;
  }

  async fold(e: LedgerEntry): Promise<void> {
    if (e.streamId.startsWith("member:")) await this.foldMember(e);
    else if (e.streamId.startsWith("batch:") && ["UpdateSetBuilt", "UpdateSetApproved", "UpdateSetRejected", "UpdateSetExported"].includes(e.eventType)) await this.foldUpdateSet(e);
  }

  private async foldMember(e: LedgerEntry): Promise<void> {
    const sinPseudo = e.streamId.slice("member:".length);
    const p = e.payload as Record<string, unknown>;
    const s = await this.state(sinPseudo, typeof p.sinMasked === "string" ? p.sinMasked : null);
    const names = await this.namesOf(typeof p.recordId === "string" ? p.recordId : undefined);
    if (names && (names.lastName || names.firstName)) {
      s.lastName = names.lastName;
      s.firstName = names.firstName;
    }
    const employer = await this.employerOf(e.batchId);
    if (employer && !s.employerIds.includes(employer)) s.employerIds = [...s.employerIds, employer].sort();
    switch (e.eventType) {
      case "MemberRecordValidated": {
        const v = p as unknown as MemberRecordValidatedPayload;
        if (v.eventType && v.eventDate && e.batchId) s.latestEvent = { type: v.eventType, eventDate: v.eventDate, batchId: e.batchId, lineNumber: v.lineNumber, seq: e.seq };
        bump(s, "validated");
        break;
      }
      case "MemberRecordRejected":
        bump(s, "rejected");
        break;
      case "WarningOverridden":
        bump(s, "overrides");
        break;
      case "ArielUpdateProposed": {
        const v = p as unknown as ArielUpdateProposedPayload;
        bump(s, "proposed");
        if (v.membershipStatus) {
          s.arielStatus = { status: v.membershipStatus.status, subStatus: v.membershipStatus.subStatus, effectiveDate: v.membershipStatus.effectiveDate, previousStatus: v.membershipStatusBefore?.status ?? null, previousSubStatus: v.membershipStatusBefore?.subStatus ?? null, state: "PROPOSED" };
        }
        break;
      }
      case "CorrectionAppended": {
        const v = p as unknown as CorrectionAppendedPayload;
        s.corrections += 1;
        const target = s.timeline.find((t) => t.seq === v.supersedesSeq);
        if (target) target.supersededBySeq = e.seq;
        break;
      }
      default:
        break;
    }
    s.timeline.push({ seq: e.seq, streamSeq: e.streamSeq, entryId: e.entryId, eventType: e.eventType, batchId: e.batchId, actor: e.actor, occurredAt: e.occurredAt, summary: summaryOf(e) });
    if (s.timeline.length > TIMELINE_CAP) s.timeline = s.timeline.slice(s.timeline.length - TIMELINE_CAP);
    s.lastLedgerSeq = e.seq;
    s.streamHeadHash = e.entryHash;
    s.lastEventType = e.eventType;
    s.updatedAt = e.occurredAt;
  }

  private async foldUpdateSet(e: LedgerEntry): Promise<void> {
    const p = e.payload as { updateSetId: string; contentHash?: string };
    const perMember = await this.db
      .select({ sinPseudo: arielUpdateItems.sinPseudo, sinMasked: arielUpdateItems.sinMasked, n: count() })
      .from(arielUpdateItems)
      .where(eq(arielUpdateItems.updateSetId, p.updateSetId))
      .groupBy(arielUpdateItems.sinPseudo, arielUpdateItems.sinMasked)
      .orderBy(asc(arielUpdateItems.sinPseudo));
    for (const m of perMember) {
      const s = await this.state(m.sinPseudo, m.sinMasked);
      const n = Number(m.n);
      const key = SET_PREFIX + p.updateSetId;
      switch (e.eventType) {
        case "UpdateSetBuilt": {
          const v = p as unknown as UpdateSetBuiltPayload;
          s.counts[key] = n;
          s.lastUpdateSet = { updateSetId: v.updateSetId, batchId: e.batchId ?? "", status: "PENDING_APPROVAL", itemCount: n, contentHash: v.contentHash };
          if (s.arielStatus && s.arielStatus.state !== "PROPOSED") s.arielStatus = { ...s.arielStatus, state: "PROPOSED" };
          break;
        }
        case "UpdateSetApproved":
          if (s.lastUpdateSet?.updateSetId === p.updateSetId) s.lastUpdateSet = { ...s.lastUpdateSet, status: "APPROVED" };
          if (s.arielStatus) s.arielStatus = { ...s.arielStatus, state: "APPROVED" };
          break;
        case "UpdateSetRejected":
          delete s.counts[key];
          if (s.lastUpdateSet?.updateSetId === p.updateSetId) s.lastUpdateSet = { ...s.lastUpdateSet, status: "REJECTED" };
          if (s.arielStatus) s.arielStatus = { ...s.arielStatus, state: "REJECTED" };
          break;
        case "UpdateSetExported":
          delete s.counts[key];
          s.exportedItems += n;
          if (s.lastUpdateSet?.updateSetId === p.updateSetId) s.lastUpdateSet = { ...s.lastUpdateSet, status: "EXPORTED" };
          if (s.arielStatus) s.arielStatus = { ...s.arielStatus, state: "EXPORTED" };
          break;
      }
      recomputePending(s);
      s.updatedAt = e.occurredAt;
    }
  }
}

async function checkpoint(db: DbOrTx): Promise<number> {
  const [row] = await db.select().from(projectionCheckpoints).where(eq(projectionCheckpoints.projectionName, PROJECTION_NAME));
  return row ? Number(row.lastSeq) : 0;
}

export interface ProjectionRun {
  fromSeq: number;
  toSeq: number;
  entries: number;
  members: number;
}

/**
 * Incremental fold of the global ledger tail into `member_projections` (architecture section 10.2
 * `projections`). Each page is applied with its checkpoint in one transaction, so a crash leaves a
 * consistent prefix; replaying from seq 1 yields identical rows (AC4).
 */
export async function projectLedger(ctx: AppContext, opts: { toSeq?: number } = {}): Promise<ProjectionRun> {
  const start = await checkpoint(ctx.db);
  let cursor = start;
  let entries = 0;
  const members = new Set<string>();
  for (;;) {
    const page = await ctx.db
      .select()
      .from(ledgerEntries)
      .where(and(gt(ledgerEntries.seq, cursor), ...(opts.toSeq !== undefined ? [lte(ledgerEntries.seq, opts.toSeq)] : [])))
      .orderBy(asc(ledgerEntries.seq))
      .limit(PAGE);
    if (page.length === 0) break;
    await ctx.db.transaction(async (tx) => {
      const folder = new Folder(tx);
      for (const row of page) await folder.fold(rowToEntry(row));
      for (const s of folder.touched()) {
        members.add(s.sinPseudo);
        const values = {
          sinPseudo: s.sinPseudo,
          sinMasked: s.sinMasked,
          lastName: s.lastName,
          firstName: s.firstName,
          employerIds: s.employerIds,
          latestEvent: s.latestEvent,
          arielStatus: s.arielStatus,
          pendingItems: s.pendingItems,
          exportedItems: s.exportedItems,
          corrections: s.corrections,
          lastUpdateSet: s.lastUpdateSet,
          lastEventType: s.lastEventType,
          counts: s.counts,
          lastLedgerSeq: s.lastLedgerSeq,
          streamHeadHash: s.streamHeadHash,
          timeline: s.timeline,
          updatedAt: s.updatedAt,
        };
        await tx
          .insert(memberProjections)
          .values(values)
          .onConflictDoUpdate({ target: memberProjections.sinPseudo, set: { ...values, sinPseudo: undefined } });
      }
      const last = Number(page[page.length - 1].seq);
      await tx
        .insert(projectionCheckpoints)
        .values({ projectionName: PROJECTION_NAME, lastSeq: last, updatedAt: ctx.clock().toISOString() })
        .onConflictDoUpdate({ target: projectionCheckpoints.projectionName, set: { lastSeq: last, updatedAt: ctx.clock().toISOString() } });
      cursor = last;
    });
    entries += page.length;
    if (page.length < PAGE) break;
  }
  return { fromSeq: start + 1, toSeq: cursor, entries, members: members.size };
}

/** `npm run projections:rebuild`: drop every row + checkpoint and replay from seq 1 (AC4). */
export async function rebuildProjections(ctx: AppContext): Promise<ProjectionRun> {
  await ctx.db.transaction(async (tx) => {
    await tx.delete(memberProjections);
    await tx.delete(projectionCheckpoints).where(eq(projectionCheckpoints.projectionName, PROJECTION_NAME));
  });
  return projectLedger(ctx);
}

export async function getMemberProjection(ctx: AppContext, sinPseudo: string): Promise<MemberProjection | null> {
  const [row] = await ctx.db.select().from(memberProjections).where(eq(memberProjections.sinPseudo, sinPseudo));
  return row ? rowToState(row) : null;
}

/** Projection rows as plain comparable objects (tests: rebuild identity). */
export async function dumpProjections(ctx: AppContext): Promise<MemberProjection[]> {
  const rows = await ctx.db.select().from(memberProjections).orderBy(asc(memberProjections.sinPseudo));
  return rows.map(rowToState);
}

export async function projectionsForMembers(ctx: AppContext, sinPseudos: string[]): Promise<Map<string, MemberProjection>> {
  if (sinPseudos.length === 0) return new Map();
  const rows = await ctx.db.select().from(memberProjections).where(inArray(memberProjections.sinPseudo, sinPseudos));
  return new Map(rows.map((r) => [r.sinPseudo, rowToState(r)]));
}

export async function projectionStats(ctx: AppContext): Promise<{ members: number; lastSeq: number }> {
  const [{ n }] = await ctx.db.select({ n: count() }).from(memberProjections);
  return { members: Number(n), lastSeq: await checkpoint(ctx.db) };
}