import { readFileSync } from "node:fs";
import path from "node:path";
import { EVENTS_CSV_COLUMNS } from "@/types";

export const GOLDEN_DIR = path.resolve(__dirname, "../golden");

export function goldenInput(scenario: string): Buffer {
  return readFileSync(path.join(GOLDEN_DIR, scenario, "input.csv"));
}

export function goldenJson<T>(scenario: string, file: string): T {
  return JSON.parse(readFileSync(path.join(GOLDEN_DIR, scenario, file), "utf8")) as T;
}

export const HEADER_LINE = EVENTS_CSV_COLUMNS.join(",");

/** Build a small CSV from partial rows (missing columns blank). */
export function csvOf(rows: Array<Partial<Record<(typeof EVENTS_CSV_COLUMNS)[number], string>>>, header = HEADER_LINE): Buffer {
  const lines = [header, ...rows.map((r) => EVENTS_CSV_COLUMNS.map((c) => r[c] ?? "").join(","))];
  return Buffer.from(lines.join("\r\n") + "\r\n", "latin1");
}

export const VALID_TERFIN = {
  SIN: "900000019",
  LastName: "ABLE",
  FirstName: "Anna",
  EventType: "TERFIN",
  EmploymentEndDate: "09302026",
  Weeks_CurrentYear: "38.00",
  LowContributions_CurrentYear: "1950.25",
  HighContributions_CurrentYear: "320.50",
  AnnualizedEarnings_CurrentYear: "",
  PA_CurrentYear: "8450",
  Weeks_PreviousYear: "52.00",
  LowContributions_PreviousYear: "2700.00",
  HighContributions_PreviousYear: "410.00",
  AnnualizedEarnings_PreviousYear: "",
  PA_PreviousYear: "12100",
} as const;
