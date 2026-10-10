import { jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Admin overrides layered on top of config/rules.events.json (architecture section 7.7 / 11).
 * key = "enabled" or a tolerance key such as "B37.tolerance1Weeks". History lives on the `system` ledger stream.
 */
export const rulesConfigOverrides = pgTable(
  "rules_config_overrides",
  {
    ruleId: text("rule_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.key] })],
);