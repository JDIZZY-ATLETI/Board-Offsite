import { bigint, char, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    seq: bigint("seq", { mode: "number" }).primaryKey(),
    entryId: uuid("entry_id").notNull().unique(),
    streamId: text("stream_id").notNull(),
    streamSeq: bigint("stream_seq", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    batchId: uuid("batch_id"),
    actor: text("actor").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    prevHashGlobal: char("prev_hash_global", { length: 64 }).notNull(),
    prevHashStream: char("prev_hash_stream", { length: 64 }).notNull(),
    entryHash: char("entry_hash", { length: 64 }).notNull().unique(),
  },
  (t) => [
    unique("ux_ledger_stream_seq").on(t.streamId, t.streamSeq),
    index("ix_ledger_stream").on(t.streamId, t.streamSeq),
    index("ix_ledger_batch").on(t.batchId),
    index("ix_ledger_type_time").on(t.eventType, t.occurredAt),
  ],
);

export const ledgerHeads = pgTable("ledger_heads", {
  streamId: text("stream_id").primaryKey(),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull(),
  lastHash: char("last_hash", { length: 64 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const GLOBAL_STREAM = "__global__";
