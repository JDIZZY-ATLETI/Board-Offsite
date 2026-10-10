import type { DecimalString, IsoDate } from "./events";

/** Architecture section 4.6. Everything here is keyed by sinPseudo; the raw SIN never leaves the adapter. */
export type MembershipStatusCode = "A" | "D" | "P" | "T";
export type TerminationCode = "TER" | "DEC" | "RET" | "AMA";
export type EmploymentType = "FT" | "PT";
export type ServiceTxType = "CTSRV" | "FASRV" | "ACW";
export type ContributionTxType = "RPPLOW" | "RPPHGH" | "RCAHGH";
export type TransactionIndicator = "PRV" | "CLC" | "REGUL" | "RETRO";
export type SalaryRateType = "REPORT" | "FARATE";

export interface ArielServiceTx {
  txId: string;
  type: ServiceTxType;
  amount: DecimalString;
  beginDate: IsoDate;
  endDate: IsoDate;
  paymentDate: IsoDate;
  targetDate: IsoDate;
  declarationDate: IsoDate | null;
  indicator: TransactionIndicator;
  summaryAttribute: string;
}

export interface ArielContributionTx {
  txId: string;
  type: ContributionTxType;
  amount: DecimalString;
  beginDate: IsoDate;
  endDate: IsoDate;
  paymentDate: IsoDate;
  targetDate: IsoDate;
  declarationDate: IsoDate | null;
  indicator: TransactionIndicator;
  summaryAttribute: string;
}

export interface ArielSalaryRate {
  txId: string;
  type: SalaryRateType;
  rate: DecimalString;
  effectiveDate: IsoDate;
  entryDate: IsoDate | null;
  indicator: string;
  summaryAttribute: string;
}

export interface ArielServiceBreak {
  breakId: string;
  type: string;
  startDate: IsoDate;
  /** null = open-ended (legacy Ariel stores 2200-12-31). */
  endDate: IsoDate | null;
}

export interface ArielEmployment {
  employmentId: string;
  employerId: string;
  permanencyDate: IsoDate;
  terminationDate: IsoDate | null;
  terminationCode: TerminationCode | null;
  lastAnnualDataUpdate: IsoDate | null;
  otherInformation: string | null;
  employmentType: EmploymentType;
  terminationDataUpdate: IsoDate | null;
  employmentTypeHistory: Array<{ type: EmploymentType; effectiveDate: IsoDate }>;
  serviceBreaks: ArielServiceBreak[];
  service: ArielServiceTx[];
  contributions: ArielContributionTx[];
  salaryRates: ArielSalaryRate[];
}

export interface ArielMembership {
  status: MembershipStatusCode | string | null;
  subStatus: string | null;
  statusEffectiveDate: IsoDate | null;
  subStatusEffectiveDate: IsoDate | null;
  calculationIndicators: string[];
  statusHistory: Array<{ status: string | null; subStatus: string | null; effectiveDate: IsoDate }>;
}

export interface ArielPensionAdjustment {
  paId: string;
  employerId: string;
  calculationYear: number;
  amount: number;
  calculationDate: IsoDate;
  entryDate: IsoDate;
}

/** Member as exposed outside the adapter: pseudonymised, masked, never the raw SIN. */
export interface ArielMemberSnapshot {
  memberId: string;
  sinPseudo: string;
  sinMasked: string;
  lastName: string | null;
  firstName: string | null;
  dateOfBirth: IsoDate;
  dateOfDeath: IsoDate | null;
  membership: ArielMembership;
  employments: ArielEmployment[];
  pensionAdjustments: ArielPensionAdjustment[];
  addresses: Array<{ effectiveStartDate: IsoDate }>;
  /** Seed label (e.g. "M7") - dev/mock only. */
  scenario?: string;
}

export type RateTableName = "MGA" | "PAMAXDB" | "REDFE" | "LOWRATE" | "HIGHRATE";
export const RATE_TABLE_NAMES: readonly RateTableName[] = ["MGA", "PAMAXDB", "REDFE", "LOWRATE", "HIGHRATE"];

export interface RateTableRow {
  table: RateTableName;
  year: number;
  value: DecimalString;
  /** Architecture section 18 Q9: values not confirmed by HOOPP. */
  placeholder: boolean;
}

/**
 * Rate lookups return `null` for a year the tables do not cover (architecture section 18 Q9 / Phase 2 QA
 * BUG-L2-RATES-1): rules must skip, never throw.
 */
export interface ArielRateTables {
  ympe(year: number): DecimalString | null;
  paMaxDb(year: number): DecimalString | null;
  paOffset(year: number): DecimalString | null;
  lowContributionRate(year: number): DecimalString | null;
  highContributionRate(year: number): DecimalString | null;
  /** Earliest year for which every table has a value; null when the tables are empty. */
  firstYear(): number | null;
  rows(): RateTableRow[];
}

/** Persisted to silver/ariel-snapshot.ndjson; one line per snapshot member plus a meta line. */
export interface ArielSnapshotMeta {
  kind: "meta";
  schemaVersion: 1;
  adapter: string;
  /** In-memory only; omitted from the persisted meta line so the snapshot hash depends on the data alone. */
  batchId?: string;
  employerId: string;
  requested: number;
  found: number;
}
