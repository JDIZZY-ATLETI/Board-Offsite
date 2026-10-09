import { bigint, bigserial, char, inet, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const memberProjections = pgTable("member_projections", {
  sinPseudo: char("sin_pseudo", { length: 64 }).primaryKey(),
  sinMasked: char("sin_masked", { length: 11 }).notNull(),
  lastName: text("last_name"),
  firstName: text("first_name"),
  employerIds: jsonb("employer_ids").$type<string[]>().notNull().default([]),
  latestEvent: jsonb("latest_event"),
  arielStatus: jsonb("ariel_status"),
  pendingItems: integer("pending_items").notNull().default(0),
  exportedItems: integer("exported_items").notNull().default(0),
  lastLedgerSeq: bigint("last_ledger_seq", { mode: "number" }).notNull(),
  streamHeadHash: char("stream_head_hash", { length: 64 }).notNull(),
  timeline: jsonb("timeline").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const projectionCheckpoints = pgTable("projection_checkpoints", {
  projectionName: text("projection_name").primaryKey(),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  role: text("role"),
  action: text("action").notNull(),
  target: text("target"),
  ip: inet("ip"),
  details: jsonb("details"),
});
