import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, char, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types";
import { batchStatusEnum, findingLevelEnum, findingSeverityEnum, findingVisibilityEnum } from "./enums";

export const rawFiles = pgTable("raw_files", {
  rawFileId: uuid("raw_file_id").primaryKey(),
  originalFilename: text("original_filename").notNull(),
  sha256: char("sha256", { length: 64 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  encodingDetected: text("encoding_detected").notNull(),
  lakePath: text("lake_path").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const batches = pgTable(
  "batches",
  {
    batchId: uuid("batch_id").primaryKey(),
    employerId: text("employer_id").notNull(),
    fileType: text("file_type").notNull(),
    sourceSystem: text("source_system").notNull().default("HOOPP_CSV"),
    status: batchStatusEnum("status").notNull().default("RECEIVED"),
    executionDate: date("execution_date", { mode: "string" }).notNull(),
    rawFileId: uuid("raw_file_id")
      .notNull()
      .references(() => rawFiles.rawFileId),
    fileSha256: char("file_sha256", { length: 64 }).notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsAccepted: integer("rows_accepted").notNull().default(0),
    rowsRejected: integer("rows_rejected").notNull().default(0),
    warningsTotal: integer("warnings_total").notNull().default(0),
    infosTotal: integer("infos_total").notNull().default(0),
    heldTotal: integer("held_total").notNull().default(0),
    rulesConfigHash: char("rules_config_hash", { length: 64 }),
    arielSnapshotHash: char("ariel_snapshot_hash", { length: 64 }),
    arielAdapter: text("ariel_adapter"),
    failureReason: text("failure_reason"),
    /** Current (latest build) update set; Phase 3. */
    updateSetId: uuid("update_set_id"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    rejectedBy: text("rejected_by"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "string" }),
    rejectedReason: text("rejected_reason"),
    reopenedBy: text("reopened_by"),
    reopenedAt: timestamp("reopened_at", { withTimezone: true, mode: "string" }),
    exportedAt: timestamp("exported_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_batches_employer_sha")
      .on(t.employerId, t.fileSha256)
      .where(sql`${t.status} <> 'FILE_REJECTED'`),
    index("ix_batches_status_received").on(t.status, t.receivedAt),
    index("ix_batches_received").on(t.receivedAt),
  ],
);

export const batchStatusHistory = pgTable("batch_status_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => batches.batchId),
  fromStatus: batchStatusEnum("from_status"),
  toStatus: batchStatusEnum("to_status").notNull(),
  actor: text("actor").notNull(),
  at: timestamp("at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  note: text("note"),
});

export const eventsRecords = pgTable(
  "events_records",
  {
    recordId: uuid("record_id").primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.batchId),
    lineNumber: integer("line_number").notNull(),
    sinPseudo: char("sin_pseudo", { length: 64 }),
    sinMasked: char("sin_masked", { length: 11 }),
    sinEnc: bytea("sin_enc"),
    lastName: text("last_name"),
    firstName: text("first_name"),
    eventType: text("event_type"),
    employmentEndDate: date("employment_end_date", { mode: "string" }),
    dateOfDeath: date("date_of_death", { mode: "string" }),
    eventYear: integer("event_year"),
    cyWeeks: numeric("cy_weeks", { precision: 6, scale: 2 }),
    cyLow: numeric("cy_low", { precision: 10, scale: 2 }),
    cyHigh: numeric("cy_high", { precision: 10, scale: 2 }),
    cyAe: integer("cy_ae"),
    cyPa: integer("cy_pa"),
    pyWeeks: numeric("py_weeks", { precision: 6, scale: 2 }),
    pyLow: numeric("py_low", { precision: 10, scale: 2 }),
    pyHigh: numeric("py_high", { precision: 10, scale: 2 }),
    pyAe: integer("py_ae"),
    pyPa: integer("py_pa"),
    rawValues: jsonb("raw_values").$type<Record<string, string | null>>().notNull(),
    parseOk: boolean("parse_ok").notNull(),
    accepted: boolean("accepted"),
    /** ACCEPTED | REJECTED | HELD; null until validated. */
    outcome: text("outcome"),
  },
  (t) => [
    uniqueIndex("ux_records_batch_line").on(t.batchId, t.lineNumber),
    index("ix_records_batch_sin").on(t.batchId, t.sinPseudo),
    index("ix_records_sin").on(t.sinPseudo),
  ],
);

export const validationFindings = pgTable(
  "validation_findings",
  {
    findingId: uuid("finding_id").primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.batchId),
    recordId: uuid("record_id").references(() => eventsRecords.recordId),
    lineNumber: integer("line_number"),
    sinPseudo: char("sin_pseudo", { length: 64 }),
    ruleId: text("rule_id").notNull(),
    messageId: text("message_id").notNull(),
    level: findingLevelEnum("level").notNull(),
    severity: findingSeverityEnum("severity").notNull(),
    visibility: findingVisibilityEnum("visibility").notNull().default("PUBLIC"),
    field: text("field"),
    yearScope: text("year_scope"),
    params: jsonb("params").$type<Record<string, string | number>>().notNull().default({}),
    dataImportMessage: text("data_import_message").notNull(),
    portalMessage: text("portal_message").notNull(),
    overrideReasons: jsonb("override_reasons").$type<string[]>().notNull().default([]),
    overrideReason: text("override_reason"),
    overrideActor: text("override_actor"),
    overrideAt: timestamp("override_at", { withTimezone: true, mode: "string" }),
    overrideNote: text("override_note"),
    overrideLedgerSeq: bigint("override_ledger_seq", { mode: "number" }),
    calculated: jsonb("calculated").$type<Record<string, string | number | boolean>>(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_findings_batch_sev").on(t.batchId, t.severity),
    index("ix_findings_batch_line").on(t.batchId, t.lineNumber, t.sortOrder),
    index("ix_findings_record").on(t.recordId),
    index("ix_findings_rule").on(t.ruleId),
  ],
);
