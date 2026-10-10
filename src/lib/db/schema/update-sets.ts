import { sql } from "drizzle-orm";
import { bigint, char, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { batches } from "./batches";
import { arielOperationEnum, updateSetStatusEnum } from "./enums";
import { ledgerEntries } from "./ledger";

/** One row per build; a batch gains a new row (build_no + 1) after reopen -> rebuild (architecture section 9.6). */
export const arielUpdateSets = pgTable(
  "ariel_update_sets",
  {
    updateSetId: uuid("update_set_id").primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.batchId),
    buildNo: integer("build_no").notNull().default(1),
    employerId: text("employer_id"),
    status: updateSetStatusEnum("status").notNull().default("BUILDING"),
    itemCount: integer("item_count").notNull().default(0),
    memberCount: integer("member_count").notNull().default(0),
    contentHash: char("content_hash", { length: 64 }),
    counts: jsonb("counts").$type<Record<string, Record<string, number>>>().notNull().default({}),
    artifacts: jsonb("artifacts").$type<Record<string, string>>().notNull().default({}),
    ledgerEntryId: uuid("ledger_entry_id"),
    ledgerSeq: bigint("ledger_seq", { mode: "number" }),
    builtAt: timestamp("built_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index("ix_update_sets_batch").on(t.batchId, t.buildNo)],
);

export const arielUpdateItems = pgTable(
  "ariel_update_items",
  {
    itemId: uuid("item_id").primaryKey(),
    updateSetId: uuid("update_set_id")
      .notNull()
      .references(() => arielUpdateSets.updateSetId),
    sinPseudo: char("sin_pseudo", { length: 64 }).notNull(),
    sinMasked: char("sin_masked", { length: 11 }),
    memberDisplay: text("member_display").notNull(),
    employerId: text("employer_id").notNull(),
    recordId: uuid("record_id"),
    lineNumber: integer("line_number"),
    eventType: text("event_type"),
    eventDate: date("event_date", { mode: "string" }),
    recordType: text("record_type").notNull(),
    operation: arielOperationEnum("operation").notNull(),
    yearScope: text("year_scope"),
    targetKey: jsonb("target_key").notNull(),
    fields: jsonb("fields").notNull(),
    beforeValues: jsonb("before_values"),
    sourceFields: jsonb("source_fields").notNull().default([]),
    derivationRule: text("derivation_rule").notNull(),
    explanation: text("explanation").notNull(),
    calculated: jsonb("calculated"),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.entryId),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [
    index("ix_items_set_member").on(t.updateSetId, t.sinPseudo, t.sortOrder),
    index("ix_items_member").on(t.sinPseudo),
    index("ix_items_set_type").on(t.updateSetId, t.recordType),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    approvalId: uuid("approval_id").primaryKey(),
    updateSetId: uuid("update_set_id")
      .notNull()
      .references(() => arielUpdateSets.updateSetId),
    decision: text("decision").notNull(),
    actor: text("actor").notNull(),
    role: text("role").notNull(),
    reason: text("reason"),
    contentHashAtDecision: char("content_hash_at_decision", { length: 64 }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.entryId),
  },
  (t) => [
    check("ck_approvals_decision", sql`${t.decision} IN ('APPROVED','REJECTED')`),
    check("ck_approvals_reason", sql`${t.decision} <> 'REJECTED' OR ${t.reason} IS NOT NULL`),
    uniqueIndex("ux_approvals_one_final").on(t.updateSetId).where(sql`${t.decision} = 'APPROVED'`),
  ],
);

export const exports = pgTable(
  "exports",
  {
    exportId: uuid("export_id").primaryKey(),
    updateSetId: uuid("update_set_id")
      .notNull()
      .references(() => arielUpdateSets.updateSetId),
    batchId: uuid("batch_id"),
    actor: text("actor").notNull(),
    format: text("format").notNull().default("both"),
    contentHash: char("content_hash", { length: 64 }),
    exportedAt: timestamp("exported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    exportDir: text("export_dir"),
    jsonPath: text("json_path"),
    csvPath: text("csv_path"),
    manifestPath: text("manifest_path"),
    jsonSha256: char("json_sha256", { length: 64 }),
    csvSha256: char("csv_sha256", { length: 64 }),
    manifestSha256: char("manifest_sha256", { length: 64 }),
    files: jsonb("files").$type<Array<{ name: string; path: string; sha256: string; bytes: number; contentType: string }>>().notNull().default([]),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.entryId),
    ledgerSeq: bigint("ledger_seq", { mode: "number" }),
  },
  (t) => [index("ix_exports_batch").on(t.batchId)],
);