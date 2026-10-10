import { bigserial, boolean, char, date, index, integer, jsonb, numeric, pgSchema, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types";

export const arielMock = pgSchema("ariel_mock");

export const mockMembers = arielMock.table(
  "members",
  {
    memberId: uuid("member_id").primaryKey(),
    sinEnc: bytea("sin_enc").notNull(),
    sinPseudo: char("sin_pseudo", { length: 64 }).notNull(),
    lastName: text("last_name"),
    firstName: text("first_name"),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    dateOfDeath: date("date_of_death", { mode: "string" }),
    // Nullable so the B203 data-quality guard can be exercised with seed data.
    status: text("status"),
    subStatus: text("sub_status"),
    statusEffectiveDate: date("status_effective_date", { mode: "string" }),
    subStatusEffectiveDate: date("sub_status_effective_date", { mode: "string" }),
    calculationIndicators: jsonb("calculation_indicators").$type<string[]>().notNull().default([]),
    scenario: text("scenario"),
  },
  (t) => [index("ix_mock_members_sin").on(t.sinPseudo)],
);

export const mockMembershipStatusHistory = arielMock.table("membership_status_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  memberId: uuid("member_id").references(() => mockMembers.memberId),
  status: text("status"),
  subStatus: text("sub_status"),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
});

export const mockEmployers = arielMock.table("employers", {
  employerId: text("employer_id").primaryKey(),
  name: text("name").notNull(),
  yearEndClosedIndicator: date("year_end_closed_indicator", { mode: "string" }),
});

export const mockEmployments = arielMock.table("employments", {
  employmentId: uuid("employment_id").primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => mockMembers.memberId),
  employerId: text("employer_id")
    .notNull()
    .references(() => mockEmployers.employerId),
  permanencyDate: date("permanency_date", { mode: "string" }).notNull(),
  terminationDate: date("termination_date", { mode: "string" }),
  terminationCode: text("termination_code"),
  lastAnnualDataUpdate: date("last_annual_data_update", { mode: "string" }),
  otherInformation: text("other_information"),
  employmentType: text("employment_type").notNull(),
  terminationDataUpdate: date("termination_data_update", { mode: "string" }),
});

export const mockEmploymentTypeHistory = arielMock.table("employment_type_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  employmentId: uuid("employment_id").references(() => mockEmployments.employmentId),
  type: text("type").notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
});

export const mockServiceBreaks = arielMock.table("service_breaks", {
  breakId: uuid("break_id").primaryKey(),
  employmentId: uuid("employment_id")
    .notNull()
    .references(() => mockEmployments.employmentId),
  type: text("type").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
});

export const mockServiceTx = arielMock.table("service_tx", {
  txId: uuid("tx_id").primaryKey(),
  employmentId: uuid("employment_id")
    .notNull()
    .references(() => mockEmployments.employmentId),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 8, scale: 4 }).notNull(),
  beginDate: date("begin_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  paymentDate: date("payment_date", { mode: "string" }).notNull(),
  targetDate: date("target_date", { mode: "string" }).notNull(),
  declarationDate: date("declaration_date", { mode: "string" }),
  indicator: text("indicator").notNull(),
  summaryAttribute: text("summary_attribute").notNull(),
});

export const mockContributionTx = arielMock.table("contribution_tx", {
  txId: uuid("tx_id").primaryKey(),
  employmentId: uuid("employment_id")
    .notNull()
    .references(() => mockEmployments.employmentId),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  beginDate: date("begin_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  paymentDate: date("payment_date", { mode: "string" }).notNull(),
  targetDate: date("target_date", { mode: "string" }).notNull(),
  declarationDate: date("declaration_date", { mode: "string" }),
  indicator: text("indicator").notNull(),
  summaryAttribute: text("summary_attribute").notNull(),
});

export const mockSalaryRates = arielMock.table("salary_rates", {
  txId: uuid("tx_id").primaryKey(),
  employmentId: uuid("employment_id")
    .notNull()
    .references(() => mockEmployments.employmentId),
  type: text("type").notNull(),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  entryDate: date("entry_date", { mode: "string" }),
  indicator: text("indicator").notNull(),
  summaryAttribute: text("summary_attribute").notNull(),
});

export const mockPensionAdjustments = arielMock.table("pension_adjustments", {
  paId: uuid("pa_id").primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => mockMembers.memberId),
  employerId: text("employer_id").notNull(),
  calculationYear: integer("calculation_year").notNull(),
  amount: integer("amount").notNull(),
  calculationDate: date("calculation_date", { mode: "string" }).notNull(),
  entryDate: date("entry_date", { mode: "string" }).notNull(),
});

export const mockAddresses = arielMock.table("addresses", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  memberId: uuid("member_id").references(() => mockMembers.memberId),
  effectiveStartDate: date("effective_start_date", { mode: "string" }).notNull(),
});

export const mockRateTables = arielMock.table(
  "rate_tables",
  {
    tableName: text("table_name").notNull(),
    year: integer("year").notNull(),
    value: numeric("value", { precision: 14, scale: 4 }).notNull(),
    placeholder: boolean("placeholder").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.tableName, t.year] })],
);
