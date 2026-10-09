/** Civil date, no timezone: YYYY-MM-DD. */
export type IsoDate = `${number}-${number}-${number}`;
/** Decimal literal as string, e.g. "523.64". Never an IEEE float in domain code. */
export type DecimalString = string;

export type EventType = "TERFIN" | "DECFIN" | "RETFIN";
export const EVENT_TYPES: readonly EventType[] = ["TERFIN", "DECFIN", "RETFIN"];

/** Column names exactly as they must appear in the CSV header (order is the layout order). */
export const EVENTS_CSV_COLUMNS = [
  "SIN",
  "LastName",
  "FirstName",
  "EventType",
  "EmploymentEndDate",
  "Weeks_CurrentYear",
  "LowContributions_CurrentYear",
  "HighContributions_CurrentYear",
  "AnnualizedEarnings_CurrentYear",
  "PA_CurrentYear",
  "Weeks_PreviousYear",
  "LowContributions_PreviousYear",
  "HighContributions_PreviousYear",
  "AnnualizedEarnings_PreviousYear",
  "PA_PreviousYear",
] as const;
export type EventsCsvColumn = (typeof EVENTS_CSV_COLUMNS)[number];

/** Optional extra column tolerated per architecture section 18 Q1 (GUI-only field in the legacy layout). */
export const OPTIONAL_CSV_COLUMNS = ["DateOfDeath"] as const;
export type OptionalCsvColumn = (typeof OPTIONAL_CSV_COLUMNS)[number];
export type AnyCsvColumn = EventsCsvColumn | OptionalCsvColumn;

export const DECIMAL_COLUMNS = [
  "Weeks_CurrentYear",
  "LowContributions_CurrentYear",
  "HighContributions_CurrentYear",
  "Weeks_PreviousYear",
  "LowContributions_PreviousYear",
  "HighContributions_PreviousYear",
] as const satisfies readonly EventsCsvColumn[];

export const INTEGER_COLUMNS = [
  "AnnualizedEarnings_CurrentYear",
  "PA_CurrentYear",
  "AnnualizedEarnings_PreviousYear",
  "PA_PreviousYear",
] as const satisfies readonly EventsCsvColumn[];

export const DATE_COLUMNS = ["EmploymentEndDate", "DateOfDeath"] as const satisfies readonly AnyCsvColumn[];

/** Max length including decimal point (I3). */
export const MAX_LENGTHS: Readonly<Partial<Record<EventsCsvColumn, number>>> = {
  Weeks_CurrentYear: 5,
  LowContributions_CurrentYear: 8,
  HighContributions_CurrentYear: 8,
  AnnualizedEarnings_CurrentYear: 6,
  PA_CurrentYear: 5,
  Weeks_PreviousYear: 5,
  LowContributions_PreviousYear: 8,
  HighContributions_PreviousYear: 8,
  AnnualizedEarnings_PreviousYear: 6,
  PA_PreviousYear: 5,
};

/** Mandatory-field matrix (architecture section 4.1). SIN is handled exclusively by I2. */
export const ALWAYS_MANDATORY_COLUMNS = [
  "LastName",
  "FirstName",
  "EventType",
  "Weeks_CurrentYear",
  "LowContributions_CurrentYear",
  "PA_CurrentYear",
] as const satisfies readonly EventsCsvColumn[];

export type RawValues = Record<EventsCsvColumn, string | null> & { DateOfDeath?: string | null };

/** Raw row as read from the file: untrimmed strings, null when the cell is empty or the column is absent. */
export interface RawEventsRow {
  /** 1-based physical line in the file (header = 1). */
  lineNumber: number;
  values: RawValues;
  /** Cells beyond the header width (I50). */
  extraValues: string[];
}

export type YearScope = "CURRENT" | "PREVIOUS";

/**
 * Parsed year block. `null` = blank in file; `undefined` = present but failed L1 parsing
 * (a finding carries the reason).
 */
export interface YearBlock {
  weeks: DecimalString | null | undefined;
  lowContributions: DecimalString | null | undefined;
  highContributions: DecimalString | null | undefined;
  annualizedEarnings: number | null | undefined;
  pa: number | null | undefined;
}

export interface EventsRecord {
  recordId: string;
  batchId: string;
  lineNumber: number;
  /** 9 digits, left-padded; raw, in-memory only. null when blank. */
  sin: string | null;
  /** HMAC-SHA256(key, sin) hex; persisted/indexed form. null when SIN blank. */
  sinPseudo: string | null;
  sinMasked: string | null;
  lastName: string | null;
  firstName: string | null;
  eventType: EventType | null | undefined;
  employmentEndDate: IsoDate | null | undefined;
  dateOfDeath: IsoDate | null | undefined;
  currentYear: YearBlock;
  previousYear: YearBlock;
  eventYear: number | undefined;
  eventDate: IsoDate | undefined;
  /** Original strings per column (raw SIN; masked before persistence). */
  rawValues: RawValues;
  extraValues: string[];
}

export type RecordOutcome = "ACCEPTED" | "REJECTED" | "HELD";
