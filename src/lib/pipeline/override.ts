import { and, eq, sql } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { ApiError } from "@/lib/api/errors";
import { canAccessEmployer } from "@/lib/auth/roles";
import { auditLog, batches, eventsRecords, validationFindings } from "@/lib/db/schema";
import { ingestDateOf, lakePaths } from "@/lib/lake/paths";
import type { LedgerDraft } from "@/lib/ledger/service";
import { memberStream } from "@/lib/ledger/streams";
import { toFinding } from "@/lib/queries/findings";
import { outcomeOf } from "@/lib/rules/engine";
import type { EventsRecord, IsoDate, RecordOutcome, Session, ValidationFinding, WarningOverriddenPayload } from "@/types";
import { validatedPayload, writeSummaryReports } from "./run";

export interface OverrideRequest {
  reason: string;
  note?: string;
}

export interface OverrideResult {
  finding: ValidationFinding;
  rowOutcome: RecordOutcome;
  heldRemaining: number;
  ledgerSeq: number;
}

export function canOverride(ctx: AppContext, session: Session, employerId: string): boolean {
  if (session.role === "Reviewer" || session.role === "Admin") return true;
  return session.role === "EmployerSubmitter" && ctx.config.allowSubmitterOverride && canAccessEmployer(session, employerId);
}

/**
 * Warning override (architecture section 7.5 / 11; UX section 6.4). Reason must be one the rule lists; "Other"
 * reasons need a note. Row moves HELD -> ACCEPTED when no blocking warning remains; ledgered as
 * WarningOverridden (+ MemberRecordValidated when the row is accepted); audit-logged.
 */
export async function overrideFinding(ctx: AppContext, session: Session, findingId: string, req: OverrideRequest, opts: { batchId?: string; ip?: string | null } = {}): Promise<OverrideResult> {
  const [row] = await ctx.db.select().from(validationFindings).where(eq(validationFindings.findingId, findingId));
  if (!row || (opts.batchId && row.batchId !== opts.batchId)) throw new ApiError(404, "NOT_FOUND", "finding not found");
  const [batch] = await ctx.db.select().from(batches).where(eq(batches.batchId, row.batchId));
  if (!batch || !canAccessEmployer(session, batch.employerId)) throw new ApiError(404, "NOT_FOUND", "finding not found");
  if (!canOverride(ctx, session, batch.employerId)) {
    throw new ApiError(403, "FORBIDDEN", session.role === "EmployerSubmitter" ? "Warning overrides are recorded by a HOOPP reviewer." : `role ${session.role} may not override warnings`);
  }
  if (row.severity !== "WARNING") throw new ApiError(422, "NOT_OVERRIDABLE", "Only WARNING findings can be overridden.");
  if (row.overrideReason) throw new ApiError(409, "ALREADY_OVERRIDDEN", "This warning already has an override.");
  if (!row.overrideReasons.includes(req.reason)) throw new ApiError(422, "REASON_NOT_ALLOWED", "That reason is not one the rule allows.", { allowed: row.overrideReasons });
  const needsNote = /^other\b/i.test(req.reason);
  const note = req.note?.trim() || undefined;
  if (needsNote && !note) throw new ApiError(422, "NOTE_REQUIRED", "Please add a short explanation for an \"Other\" reason.");
  if (batch.status !== "VALIDATED") throw new ApiError(422, "BATCH_NOT_VALIDATED", `Overrides are only possible while the batch is Validated (current: ${batch.status}).`);
  if (!row.recordId) throw new ApiError(422, "NOT_OVERRIDABLE", "File-level findings cannot be overridden.");

  const at = ctx.clock().toISOString();
  return ctx.db.transaction(async (tx) => {
    const [record] = await tx.select().from(eventsRecords).where(eq(eventsRecords.recordId, row.recordId!));
    if (!record) throw new ApiError(404, "NOT_FOUND", "record not found");
    await tx
      .update(validationFindings)
      .set({ overrideReason: req.reason, overrideActor: session.actor, overrideAt: at, overrideNote: note ?? null })
      .where(eq(validationFindings.findingId, findingId));
    const siblings = (await tx.select().from(validationFindings).where(eq(validationFindings.recordId, row.recordId!))).map(toFinding).sort((a, b) => a.sortOrder - b.sortOrder);
    const rowOutcome = outcomeOf(siblings);
    const previousOutcome = (record.outcome as RecordOutcome | null) ?? "HELD";
    const becameAccepted = previousOutcome === "HELD" && rowOutcome === "ACCEPTED";

    const eventsRecord: EventsRecord = {
      recordId: record.recordId,
      batchId: record.batchId,
      lineNumber: record.lineNumber,
      sin: null,
      sinPseudo: record.sinPseudo,
      sinMasked: record.sinMasked,
      lastName: record.lastName,
      firstName: record.firstName,
      eventType: (record.eventType as EventsRecord["eventType"]) ?? null,
      employmentEndDate: (record.employmentEndDate as IsoDate | null) ?? null,
      dateOfDeath: (record.dateOfDeath as IsoDate | null) ?? null,
      currentYear: { weeks: record.cyWeeks, lowContributions: record.cyLow, highContributions: record.cyHigh, annualizedEarnings: record.cyAe, pa: record.cyPa },
      previousYear: { weeks: record.pyWeeks, lowContributions: record.pyLow, highContributions: record.pyHigh, annualizedEarnings: record.pyAe, pa: record.pyPa },
      eventYear: record.eventYear ?? undefined,
      eventDate: ((record.eventType === "DECFIN" ? record.dateOfDeath : record.employmentEndDate) as IsoDate | null) ?? undefined,
      rawValues: record.rawValues as EventsRecord["rawValues"],
      extraValues: [],
    };

    const payload: WarningOverriddenPayload = {
      findingId,
      recordId: record.recordId,
      lineNumber: record.lineNumber,
      sinMasked: record.sinMasked,
      ruleId: row.ruleId,
      messageId: row.messageId,
      yearScope: (row.yearScope as WarningOverriddenPayload["yearScope"]) ?? null,
      reason: req.reason,
      ...(note ? { note } : {}),
      rowOutcome,
    };
    const stream = record.sinPseudo ? memberStream(record.sinPseudo) : `batch:${record.batchId}`;
    const drafts: LedgerDraft[] = [{ streamId: stream, eventType: "WarningOverridden", batchId: record.batchId, actor: session.actor, payload: payload as unknown as Record<string, unknown> }];
    if (becameAccepted) {
      drafts.push({ streamId: stream, eventType: "MemberRecordValidated", batchId: record.batchId, actor: session.actor, payload: validatedPayload(eventsRecord, siblings, batch.rulesConfigHash ?? "", batch.arielSnapshotHash ?? "") as unknown as Record<string, unknown> });
    }
    const entries = await ctx.ledger.appendMany(drafts, tx);
    await tx.update(validationFindings).set({ overrideLedgerSeq: entries[0].seq }).where(eq(validationFindings.findingId, findingId));

    let heldRemaining = batch.heldTotal;
    if (becameAccepted) {
      await tx.update(eventsRecords).set({ accepted: true, outcome: "ACCEPTED" }).where(eq(eventsRecords.recordId, record.recordId));
      await tx
        .update(batches)
        .set({ heldTotal: sql`greatest(${batches.heldTotal} - 1, 0)`, rowsAccepted: sql`${batches.rowsAccepted} + 1`, updatedAt: at })
        .where(and(eq(batches.batchId, batch.batchId)));
      heldRemaining = Math.max(0, batch.heldTotal - 1);
    }
    await tx.insert(auditLog).values({
      at,
      actor: session.actor,
      role: session.role,
      action: "OVERRIDE_WARNING",
      target: `finding:${findingId}`,
      ip: opts.ip && /^[0-9a-fA-F.:]+$/.test(opts.ip) ? opts.ip : null,
      details: { batchId: batch.batchId, ruleId: row.ruleId, reason: req.reason, rowOutcome, ledgerSeq: entries[0].seq },
    });

    const all = (await tx.select().from(validationFindings).where(eq(validationFindings.batchId, batch.batchId))).map(toFinding);
    await writeSummaryReports(ctx, lakePaths({ employerId: batch.employerId, batchId: batch.batchId, ingestDate: ingestDateOf(batch.receivedAt) }), all);

    const updated = siblings.find((f) => f.findingId === findingId)!;
    return { finding: { ...updated, override: { ...updated.override!, ledgerSeq: entries[0].seq } }, rowOutcome, heldRemaining, ledgerSeq: entries[0].seq };
  });
}

export interface BulkOverrideResult {
  results: Array<{ findingId: string; ok: true; rowOutcome: RecordOutcome; ledgerSeq: number } | { findingId: string; ok: false; status: number; code: string; message: string }>;
  heldRemaining: number;
}

/** Bulk variant: each override is its own transaction and ledger entry (UX section 5.4.2). */
export async function overrideFindings(ctx: AppContext, session: Session, findingIds: string[], req: OverrideRequest, opts: { batchId?: string; ip?: string | null } = {}): Promise<BulkOverrideResult> {
  const results: BulkOverrideResult["results"] = [];
  let heldRemaining = 0;
  for (const id of findingIds) {
    try {
      const r = await overrideFinding(ctx, session, id, req, opts);
      heldRemaining = r.heldRemaining;
      results.push({ findingId: id, ok: true, rowOutcome: r.rowOutcome, ledgerSeq: r.ledgerSeq });
    } catch (err) {
      if (err instanceof ApiError) results.push({ findingId: id, ok: false, status: err.status, code: err.code, message: err.message });
      else throw err;
    }
  }
  return { results, heldRemaining };
}