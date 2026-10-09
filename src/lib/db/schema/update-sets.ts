import { sql } from "drizzle-orm";
import { char, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { batches } from "./batches";
import { arielOperationEnum, updateSetStatusEnum } from "./enums";
import { ledgerEntries } from "./ledger";

export const arielUpdateSets = pgTable("ariel_update_sets", {
  updateSetId: uuid("update_set_id").primaryKey(),
  batchId: uuid("batch_id")
    .notNull()
    .unique()
    .references(() => batches.batchId),
  status: updateSetStatusEnum("status").notNull().default("BUILDING"),
  itemCount: integer("item_count").notNull().default(0),
  memberCount: integer("member_count").notNull().default(0),
  contentHash: char("content_hash", { length: 64 }),
  artifacts: jsonb("artifacts").$type<Record<string, string>>().notNull().default({}),
  builtAt: timestamp("built_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const arielUpdateItems = pgTable(
  "ariel_update_items",
  {
    itemId: uuid("item_id").primaryKey(),
    updateSetId: uuid("update_set_id")
      .notNull()
      .references(() => arielUpdateSets.updateSetId),
    sinPseudo: char("sin_pseudo", { length: 64 }).notNull(),
    memberDisplay: text("member_display").notNull(),
    employerId: text("employer_id").notNull(),
    recordType: text("record_type").notNull(),
    operation: arielOperationEnum("operation").notNull(),
    targetKey: jsonb("target_key").notNull(),
    fields: jsonb("fields").notNull(),
    beforeValues: jsonb("before_values"),
    sourceFields: jsonb("source_fields").notNull().default([]),
    derivationRule: text("derivation_rule").notNull(),
    explanation: text("explanation").notNull(),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.entryId),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [
    index("ix_items_set_member").on(t.updateSetId, t.sinPseudo, t.sortOrder),
    index("ix_items_member").on(t.sinPseudo),
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

export const exports = pgTable("exports", {
  exportId: uuid("export_id").primaryKey(),
  updateSetId: uuid("update_set_id")
    .notNull()
    .references(() => arielUpdateSets.updateSetId),
  actor: text("actor").notNull(),
  exportedAt: timestamp("exported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  jsonPath: text("json_path").notNull(),
  csvPath: text("csv_path").notNull(),
  jsonSha256: char("json_sha256", { length: 64 }).notNull(),
  csvSha256: char("csv_sha256", { length: 64 }).notNull(),
  ledgerEntryId: uuid("ledger_entry_id")
    .notNull()
    .references(() => ledgerEntries.entryId),
});
