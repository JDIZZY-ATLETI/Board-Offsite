/**
 * Deterministic generator for the Ariel mock seed (tests/fixtures/ariel-seed.json) and the golden Events
 * files. Re-run with `npx tsx tests/golden/generate-fixtures.ts`. SINs are synthetic (9xx range, Luhn-valid);
 * names are synthetic. Rows that must pass are computed with the same helpers the rules use so the seed and
 * the files stay consistent by construction.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import iconv from "iconv-lite";
import { EVENTS_CSV_COLUMNS } from "../../src/types/events";
import { withLuhnCheckDigit } from "../../src/lib/pii/sin";
import { placeholderRateRows, StaticRateTables } from "../../src/lib/ariel/rates";
import { calculatedPA } from "../../src/lib/rules/lib/ae";

const HEADER = EVENTS_CSV_COLUMNS.join(",");
const root = path.resolve(__dirname);
const RATES = new StaticRateTables(placeholderRateRows());
const MDC = "MDC – Core Data";
const EXEC_DATE = "2026-10-08";

export function sin(n: number): string {
  return withLuhnCheckDigit(String(90000000 + n));
}

type Row = Partial<Record<(typeof EVENTS_CSV_COLUMNS)[number], string>>;
type Iso = `${number}-${number}-${number}`;

function line(r: Row): string {
  return EVENTS_CSV_COLUMNS.map((c) => r[c] ?? "").join(",");
}
function write(dir: string, name: string, text: string, encoding: "windows-1252" | "utf8" = "windows-1252") {
  const d = path.join(root, dir);
  mkdirSync(d, { recursive: true });
  const bytes = encoding === "windows-1252" ? iconv.encode(text, "windows-1252") : Buffer.from(text, "utf8");
  writeFileSync(path.join(d, name), bytes);
  console.log(`wrote tests/golden/${dir}/${name} (${bytes.length} bytes)`);
}
function csv(rows: Row[], header = HEADER): string {
  return [header, ...rows.map(line)].join("\r\n") + "\r\n";
}
const mmdd = (iso: string) => `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(0, 4)}`;
const money = (n: number | Decimal) => new Decimal(n).toFixed(2);

// ---------------------------------------------------------------------------------------------------------
// Seed model
// ---------------------------------------------------------------------------------------------------------
interface Tx { type?: string; amount: string; beginDate: string; endDate: string; paymentDate: string; targetDate: string; indicator?: string; summaryAttribute?: string }
interface Emp {
  key?: string; employerId: string; permanencyDate: string; terminationDate?: string | null; terminationCode?: string | null; otherInformation?: string | null;
  employmentType?: "FT" | "PT"; lastAnnualDataUpdate?: string | null; typeHistory?: Array<{ type: "FT" | "PT"; effectiveDate: string }>;
  serviceBreaks?: Array<{ type: string; startDate: string; endDate: string | null }>; service?: Tx[]; contributions?: Tx[];
  salaryRates?: Array<{ type?: string; rate: string; effectiveDate: string; entryDate?: string | null }>;
}
interface Member {
  key: string; scenario: string; sin: string; lastName: string; firstName: string; dateOfBirth: string; dateOfDeath?: string | null;
  status?: string | null; subStatus?: string | null; statusEffectiveDate?: string | null; subStatusEffectiveDate?: string | null; calculationIndicators?: string[];
  statusHistory?: Array<{ status: string | null; subStatus?: string | null; effectiveDate: string }>; addresses?: Array<{ effectiveStartDate: string }>;
  pensionAdjustments?: Array<{ employerId: string; calculationYear: number; amount: number; calculationDate: string; entryDate: string }>; employments: Emp[];
}

/** Contributions consistent with annualised earnings `ae` over `weeks` of service in `year`. */
function contribs(year: number, ae: number, weeks: number): { low: string; high: string; lowN: number; highN: number } {
  const ympe = Number(RATES.ympe(year));
  const f = weeks / 52;
  const lowN = +(Math.min(ae, ympe) * 0.069 * f).toFixed(2);
  const highN = +(Math.max(0, ae - ympe) * 0.092 * f).toFixed(2);
  return { low: money(lowN), high: money(highN), lowN, highN };
}

/** A zero-service MDC Core Data posting (LTD members: the year was collected, nothing to report). */
const ZERO_MDC_2025: Tx = { type: "CTSRV", amount: "0.0000", beginDate: "2025-01-01", endDate: "2025-12-31", paymentDate: "2025-12-31", targetDate: "2025-12-31", indicator: "PRV", summaryAttribute: MDC };

/** Full-year MDC data posted in Ariel (service + contributions, summary "MDC – Core Data"). */
function mdcYear(year: number, ae: number, weeks = 52, opts: { employerId?: string; pa?: boolean } = {}): { service: Tx[]; contributions: Tx[]; pa: NonNullable<Member["pensionAdjustments"]>[number] | null } {
  const dates = { beginDate: `${year}-01-01`, endDate: `${year}-12-31`, paymentDate: `${year}-12-31`, targetDate: `${year}-12-31`, indicator: "PRV", summaryAttribute: MDC };
  const c = contribs(year, ae, weeks);
  const contributions: Tx[] = [{ type: "RPPLOW", amount: c.low, ...dates }];
  if (c.highN > 0) contributions.push({ type: "RPPHGH", amount: c.high, ...dates });
  const svc = new Decimal(weeks).div(52);
  const pa = opts.pa === false ? null : { employerId: opts.employerId ?? "0235", calculationYear: year, amount: calculatedPA(new Decimal(ae), svc, year, RATES)!.toDecimalPlaces(0).toNumber(), calculationDate: `${year}-12-31`, entryDate: `${year + 1}-01-15` };
  return { service: [{ type: "CTSRV", amount: new Decimal(weeks).toFixed(4), ...dates }], contributions, pa };
}

function ftEmp(permanencyDate: string, years: Array<{ year: number; ae: number; weeks?: number }>, over: Partial<Emp> = {}): Emp {
  const service: Tx[] = [];
  const contributions: Tx[] = [];
  for (const y of years) {
    const m = mdcYear(y.year, y.ae, y.weeks ?? 52);
    service.push(...m.service);
    contributions.push(...m.contributions);
  }
  return { employerId: "0235", permanencyDate, terminationDate: null, terminationCode: null, otherInformation: null, employmentType: "FT", lastAnnualDataUpdate: years.length ? `${Math.max(...years.map((y) => y.year))}-12-31` : null, service, contributions, ...over };
}
function pasFor(years: Array<{ year: number; ae: number; weeks?: number }>, employerId = "0235") {
  return years.map((y) => mdcYear(y.year, y.ae, y.weeks ?? 52, { employerId }).pa!).filter(Boolean);
}

const Y24 = { year: 2024, ae: 72000 };
const Y25 = { year: 2025, ae: 75000 };
const STD = [Y24, Y25];

const names = ["ABLE", "BAKER", "CHEN", "DIAZ", "EVANS", "FOX", "GREY", "HALL", "IRWIN", "JONES", "KING", "LEE", "MOORE", "NG", "OWEN", "PATEL", "QUINN", "ROSS", "SINGH", "TREMBLAY"];
const firsts = ["Anna", "Ben", "Carol", "Dan", "Eve", "Frank", "Gina", "Hugo", "Ida", "Jack", "Kim", "Liam", "Mia", "Noah", "Olivia", "Priya", "Quentin", "Rae", "Sam", "Tara"];

function base(key: string, n: number, scenario: string, over: Partial<Member> & { employments: Emp[] }): Member {
  const i = (n - 1) % 20;
  return { key, scenario, sin: sin(n), lastName: names[i], firstName: firsts[i], dateOfBirth: "1985-04-12", dateOfDeath: null, status: "A", subStatus: null, statusEffectiveDate: over.employments[0]?.permanencyDate ?? "2015-03-02", subStatusEffectiveDate: null, calculationIndicators: [], statusHistory: [{ status: "A", subStatus: null, effectiveDate: over.employments[0]?.permanencyDate ?? "2015-03-02" }], addresses: [{ effectiveStartDate: "2015-03-02" }], pensionAdjustments: pasFor(STD), ...over };
}

// ---- the 18 canonical members (architecture section 4.6) ----
const canonical: Member[] = [
  base("M1", 1, "M1 Happy path TERFIN", { employments: [ftEmp("2015-03-02", STD)] }),
  base("M2", 2, "M2 Happy path DECFIN", { employments: [ftEmp("2010-01-04", STD)] }),
  base("M3", 3, "M3 Happy path RETFIN", { employments: [ftEmp("2001-09-10", STD, { otherInformation: "RetNotice 2026-06-30", terminationDate: "2026-06-30", terminationCode: "RET" })] }),
  base("M4", 4, "M4 Already terminated", { status: "D", subStatus: "NCT", statusEffectiveDate: "2025-11-15", subStatusEffectiveDate: "2025-11-15", statusHistory: [{ status: "A", effectiveDate: "2012-02-06" }, { status: "D", subStatus: "NCT", effectiveDate: "2025-11-15" }], pensionAdjustments: pasFor([Y24]), employments: [ftEmp("2012-02-06", [Y24], { terminationDate: "2025-11-15", terminationCode: "TER", otherInformation: "Events 11152025" })] }),
  base("M5", 5, "M5 Deceased", { dateOfDeath: "2025-08-01", status: "D", subStatus: "NCT", statusEffectiveDate: "2025-08-01", subStatusEffectiveDate: "2025-08-01", pensionAdjustments: pasFor([Y24]), employments: [ftEmp("2008-09-01", [Y24], { terminationDate: "2025-08-01", terminationCode: "DEC" })] }),
  base("M6", 6, "M6 Retiree with CTSRV in year", { status: "P", statusEffectiveDate: "2026-03-01", statusHistory: [{ status: "A", effectiveDate: "1998-06-01" }, { status: "P", effectiveDate: "2026-03-01" }], employments: [ftEmp("1998-06-01", STD, { otherInformation: "RetNotice 2026-02-28", terminationDate: "2026-02-28", terminationCode: "RET", service: [...ftEmp("1998-06-01", STD).service!, { type: "CTSRV", amount: "8.0000", beginDate: "2026-01-01", endDate: "2026-02-28", paymentDate: "2026-02-28", targetDate: "2026-02-28", indicator: "PRV", summaryAttribute: "Final Data - Events" }] })] }),
  base("M7", 7, "M7 Permanency after Jan 1 of event year", { pensionAdjustments: [], employments: [ftEmp("2026-03-16", [])] }),
  base("M8", 8, "M8 Under-age edge", { dateOfBirth: "2009-05-05", pensionAdjustments: pasFor([{ year: 2025, ae: 32000, weeks: 30 }]), employments: [ftEmp("2025-06-02", [{ year: 2025, ae: 32000, weeks: 30 }])] }),
  base("M9", 9, "M9 Over-71 edge", { dateOfBirth: "1954-02-01", employments: [ftEmp("1990-05-07", STD, { otherInformation: "RetNotice 2026-04-30", terminationDate: "2026-04-30", terminationCode: "RET" })] }),
  base("M10", 10, "M10 LTD full year", { pensionAdjustments: pasFor([Y24]), employments: [ftEmp("2011-03-07", [Y24], { serviceBreaks: [{ type: "LTD", startDate: "2025-01-01", endDate: null }], salaryRates: [{ type: "FARATE", rate: "70000.00", effectiveDate: "2025-01-01" }, { type: "FARATE", rate: "70000.00", effectiveDate: "2026-01-01" }], service: [...ftEmp("2011-03-07", [Y24]).service!, ZERO_MDC_2025, { type: "ACW", amount: "0.0027", beginDate: "2025-01-01", endDate: "2025-01-01", paymentDate: "2025-01-01", targetDate: "2025-01-01", indicator: "PRV", summaryAttribute: "ACW factor" }] })] }),
  base("M11", 11, "M11 WSO (waived) break", { employments: [ftEmp("2016-09-06", STD, { serviceBreaks: [{ type: "WSO", startDate: "2026-01-01", endDate: null }] })] }),
  base("M12", 12, "M12 Part-time with NC leave", { pensionAdjustments: pasFor([{ year: 2024, ae: 52000, weeks: 26 }, { year: 2025, ae: 54000, weeks: 26 }]), employments: [ftEmp("2018-05-01", [{ year: 2024, ae: 52000, weeks: 26 }, { year: 2025, ae: 54000, weeks: 26 }], { employmentType: "PT", typeHistory: [{ type: "FT", effectiveDate: "2018-05-01" }, { type: "PT", effectiveDate: "2024-01-01" }], serviceBreaks: [{ type: "NCP", startDate: "2026-02-01", endDate: "2026-04-30" }], contributions: [...ftEmp("2018-05-01", [{ year: 2024, ae: 52000, weeks: 26 }, { year: 2025, ae: 54000, weeks: 26 }]).contributions!, { type: "RPPLOW", amount: "50.00", beginDate: "2026-02-01", endDate: "2026-04-30", paymentDate: "2026-05-15", targetDate: "2026-04-30", indicator: "PRV", summaryAttribute: "RCL" }] })] }),
  base("M13", 13, "M13 NHH member (St. Michael's, NHHSTM)", { calculationIndicators: ["NHHSTM"], pensionAdjustments: pasFor([{ year: 2017, ae: 60000 }, { year: 2018, ae: 62000 }]), employments: [ftEmp("2010-02-01", [{ year: 2017, ae: 60000 }])] }),
  base("M14", 14, "M14 Retro paid in year", { employments: [ftEmp("2013-10-07", STD, { contributions: [...ftEmp("2013-10-07", STD).contributions!, { type: "RPPLOW", amount: "300.00", beginDate: "2025-01-01", endDate: "2025-12-31", paymentDate: "2026-04-15", targetDate: "2025-12-31", indicator: "RETRO", summaryAttribute: "RRETRO" }] })] }),
  base("M15", 15, "M15 Enrolled Dec 8-31 last year", { pensionAdjustments: [], employments: [ftEmp("2025-12-15", [])] }),
  base("M6b", 16, "M6b Retiree without CTSRV in year (re-evaluation flag ON)", { lastName: "FOX", firstName: "Fiona", status: "P", statusEffectiveDate: "2026-03-01", statusHistory: [{ status: "A", effectiveDate: "1999-01-04" }, { status: "P", effectiveDate: "2026-03-01" }], employments: [ftEmp("1999-01-04", STD, { otherInformation: "RetNotice 2026-02-28", terminationDate: "2026-02-28", terminationCode: "RET" })] }),
  base("M16", 17, "M16 Concurrent employer (0235 + 0359)", { pensionAdjustments: [...pasFor(STD), ...pasFor([{ year: 2025, ae: 30000, weeks: 20 }], "0359")], employments: [ftEmp("2012-04-02", STD, { key: "0235" }), ftEmp("2020-01-06", [{ year: 2025, ae: 30000, weeks: 20 }], { key: "0359", employerId: "0359", employmentType: "PT", typeHistory: [{ type: "PT", effectiveDate: "2020-01-06" }] })] }),
  base("M17", 18, "M17 Duplicate SIN in Ariel (row 1 of 2)", { employments: [ftEmp("2014-01-06", STD)] }),
  { ...base("M17dup", 18, "M17 Duplicate SIN in Ariel (row 2 of 2)", { employments: [ftEmp("2019-08-05", [Y25])] }), firstName: "Quinn", pensionAdjustments: pasFor([Y25]) },
  base("M18", 19, "M18 Disability breaks on TERFIN", { employments: [ftEmp("2009-04-06", STD, { serviceBreaks: [{ type: "DTO", startDate: "2026-01-10", endDate: null }, { type: "NCS", startDate: "2026-05-01", endDate: null }, { type: "NCM", startDate: "2026-11-01", endDate: "2026-12-15" }] })] }),
];

// ---- golden-support members: G1..G15 happy rows, L.. rows that fire each L2 message id ----
const support: Member[] = [];
function add(m: Member) {
  support.push(m);
  return m;
}
const G = (i: number) => sin(100 + i);
for (let i = 1; i <= 19; i++) {
  const retfin = i % 7 === 0;
  const eventDate = `2026-0${(i % 9) + 1}-${String(10 + (i % 18)).padStart(2, "0")}`;
  add(base(`G${i}`, 100 + i, `G${i} golden happy ${retfin ? "RETFIN" : i % 11 === 0 ? "DECFIN" : "TERFIN"}`, { employments: [ftEmp("2015-03-02", STD, retfin ? { otherInformation: `RetNotice ${eventDate}`, terminationDate: eventDate, terminationCode: "RET" } : {})] }));
}

/** A clean, consistent current-year block for a member with no 2026 Ariel transactions. */
function cyBlock(eventDate: string, weeks: number, ae: number, over: Row = {}): Row {
  const year = Number(eventDate.slice(0, 4));
  const c = contribs(year, ae, weeks);
  const pa = calculatedPA(new Decimal(ae), new Decimal(weeks).div(52), year, RATES)!.toDecimalPlaces(0).toNumber();
  return { EmploymentEndDate: mmdd(eventDate), Weeks_CurrentYear: weeks.toFixed(2), LowContributions_CurrentYear: c.low, HighContributions_CurrentYear: c.highN > 0 ? c.high : "", AnnualizedEarnings_CurrentYear: "", PA_CurrentYear: String(pa), Weeks_PreviousYear: "", LowContributions_PreviousYear: "", HighContributions_PreviousYear: "", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: "", ...over };
}
function pyBlock(year: number, weeks: number, ae: number): Row {
  const c = contribs(year, ae, weeks);
  const pa = calculatedPA(new Decimal(ae), new Decimal(weeks).div(52), year, RATES)!.toDecimalPlaces(0).toNumber();
  return { Weeks_PreviousYear: weeks.toFixed(2), LowContributions_PreviousYear: c.low, HighContributions_PreviousYear: c.highN > 0 ? c.high : "", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: String(pa) };
}
const ZERO_CY: Row = { Weeks_CurrentYear: "0.00", LowContributions_CurrentYear: "0.00", HighContributions_CurrentYear: "", AnnualizedEarnings_CurrentYear: "", PA_CurrentYear: "0" };
const ZERO_PY: Row = { Weeks_PreviousYear: "0.00", LowContributions_PreviousYear: "0.00", HighContributions_PreviousYear: "", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: "0" };
const BLANK_PY: Row = { Weeks_PreviousYear: "", LowContributions_PreviousYear: "", HighContributions_PreviousYear: "", AnnualizedEarnings_PreviousYear: "", PA_PreviousYear: "" };

function rowFor(m: Member, eventType: "TERFIN" | "DECFIN" | "RETFIN", block: Row): Row {
  return { SIN: m.sin, LastName: m.lastName, FirstName: m.firstName, EventType: eventType, ...block };
}

// ---------------------------------------------------------------------------------------------------------
// Golden files
// ---------------------------------------------------------------------------------------------------------
const byKey = (k: string) => [...canonical, ...support].find((m) => m.key === k)!;

// happy-terfin: M1 (accented name variant kept for windows-1252 coverage), M7 mid-year enrolment, M8, M18 disability breaks
const happyTerfin: Row[] = [
  rowFor({ ...byKey("M1"), lastName: "C\u00d4T\u00c9", firstName: "Ren\u00e9e" }, "TERFIN", cyBlock("2026-09-30", 38, 78000)),
  rowFor(byKey("M7"), "TERFIN", cyBlock("2026-09-30", 27, 66000)),
  rowFor(byKey("M8"), "TERFIN", cyBlock("2026-08-14", 30, 34000)),
  rowFor(byKey("M18"), "TERFIN", cyBlock("2026-09-30", 17, 76000)),
  rowFor(byKey("G1"), "TERFIN", cyBlock("2026-02-11", 5, 76000)),
];
write("happy-terfin", "input.csv", csv(happyTerfin));

// happy-decfin: M2, G11 (DECFIN with blank previous year), G12
const happyDecfin: Row[] = [
  rowFor(byKey("M2"), "DECFIN", cyBlock("2026-07-01", 26, 77000)),
  rowFor(byKey("G11"), "DECFIN", cyBlock("2026-03-15", 10, 74000)),
  rowFor(byKey("G12"), "DECFIN", cyBlock("2026-09-30", 38, 75500)),
];
write("happy-decfin", "input.csv", csv(happyDecfin));

// happy-retfin: M3 (RetNotice 2026-06-30), M9 (RetNotice 2026-04-30), M6b (pensioner without CTSRV)
const happyRetfin: Row[] = [
  rowFor(byKey("M3"), "RETFIN", cyBlock("2026-06-30", 26, 78000)),
  rowFor(byKey("M9"), "RETFIN", cyBlock("2026-04-30", 17, 77000)),
  rowFor(byKey("M6b"), "RETFIN", cyBlock("2026-02-28", 8, 76000)),
];
write("happy-retfin", "input.csv", csv(happyRetfin));

// file-rejected-header / file-rejected-extra-values (unchanged semantics)
write("file-rejected-header", "input.csv", csv([rowFor(byKey("G2"), "TERFIN", cyBlock("2026-03-20", 11, 75000)), rowFor(byKey("G3"), "TERFIN", cyBlock("2026-05-12", 19, 75000))], HEADER.replace("LastName", "LastNme")));
write("file-rejected-extra-values", "input.csv", [HEADER, line(rowFor(byKey("G2"), "TERFIN", cyBlock("2026-03-20", 11, 75000))), line(rowFor(byKey("G3"), "TERFIN", cyBlock("2026-05-12", 19, 75000))) + ",EXTRA", line(rowFor(byKey("G4"), "TERFIN", cyBlock("2026-06-30", 26, 75000)))].join("\r\n") + "\r\n");

// ---- mixed-100-rows: 15 clean rows, 40 L1 rows (every L1 id), 45 L2 rows (every enabled L2 id) ----
const mixed: Row[] = [];
const expectL2: Record<string, string[]> = {};
function l2(id: string, ...rows: Row[]) {
  for (const r of rows) {
    mixed.push(r);
    (expectL2[id] ??= []).push(String(mixed.length + 1));
  }
}
for (let i = 1; i <= 15; i++) {
  const m = byKey(`G${i}`);
  const eventDate = m.employments[0].terminationDate ?? `2026-0${(i % 9) + 1}-${String(10 + (i % 18)).padStart(2, "0")}`;
  const weeks = Math.max(1, Math.round((Date.UTC(2026, Number(eventDate.slice(5, 7)) - 1, Number(eventDate.slice(8, 10))) - Date.UTC(2026, 0, 1)) / 86_400_000 / 7) - 1);
  mixed.push(rowFor(m, i % 7 === 0 ? "RETFIN" : i % 11 === 0 ? "DECFIN" : "TERFIN", cyBlock(eventDate, weeks, 74000 + i * 250)));
}
const L1 = (i: number, over: Row): Row => ({ SIN: sin(200 + i), LastName: names[i % 20], FirstName: firsts[i % 20], EventType: "TERFIN", ...cyBlock("2026-06-30", 26, 75000), ...over });
// Rows 17-56: the Phase 1 L1 matrix (ids in comments).
mixed.push(
  L1(61, { LastName: "" }),                                        // 8233
  L1(62, { FirstName: "" }),                                       // 8233
  L1(63, { EventType: "" }),                                       // 8233
  L1(64, { EmploymentEndDate: "" }),                               // 8233 (TERFIN)
  L1(65, { Weeks_CurrentYear: "" }),                               // 8233
  L1(66, { LowContributions_CurrentYear: "" }),                    // 8233
  L1(67, { PA_CurrentYear: "" }),                                  // 8233
  L1(68, { SIN: "" }),                                             // 2031
  L1(69, { Weeks_CurrentYear: "123.45" }),                         // 9519
  L1(70, { LowContributions_CurrentYear: "123456.78" }),           // 9519
  L1(71, { EmploymentEndDate: "13312026" }),                       // 825
  L1(72, { EmploymentEndDate: "2026-09-30" }),                     // 825
  L1(73, { Weeks_CurrentYear: "38.123" }),                         // 6503 (+9519)
  L1(74, { ...pyBlock(2025, 52, 75000), LowContributions_PreviousYear: "12.345" }), // 6642
  L1(75, { LowContributions_CurrentYear: "abc" }),                 // 6503
  L1(76, { PA_CurrentYear: "12.5" }),                              // 5131
  L1(77, { AnnualizedEarnings_PreviousYear: "-100" }),             // 5131
  L1(78, { SIN: "12345678X" }),                                    // 5131 (masked)
  L1(79, { EventType: "RETIRE" }),                                 // 8034
  L1(80, { SIN: sin(999) }),                                       // 910
  L1(81, { SIN: sin(999) }),                                       // 910
  L1(82, { AnnualizedEarnings_CurrentYear: "52000" }),             // 4999 CURRENT
  L1(83, { ...pyBlock(2025, 52, 75000), AnnualizedEarnings_PreviousYear: "60000" }), // 4999 PREVIOUS
  L1(84, { LowContributions_CurrentYear: "0" }),                   // 9349 CURRENT
  L1(85, { ...pyBlock(2025, 52, 75000), LowContributions_PreviousYear: "0.00" }),   // 9349 PREVIOUS
  L1(86, { Weeks_CurrentYear: "-1.00" }),                          // 9099
  L1(87, { LowContributions_CurrentYear: "-5" }),                  // 4423
  L1(88, { HighContributions_CurrentYear: "-0.01" }),              // 4869
  L1(89, { Weeks_PreviousYear: "-2" }),                            // 7902
  L1(90, { LowContributions_PreviousYear: "-3.50" }),              // 494
  L1(91, { HighContributions_PreviousYear: "-1" }),                // 5049
  L1(92, { EmploymentEndDate: "12312027" }),                       // 8106 TERFIN (+1418: SIN unknown to Ariel)
  L1(93, { EventType: "RETFIN", EmploymentEndDate: "01012027" }),  // 8106 RETFIN (Q5)
  L1(94, { EventType: "DECFIN", EmploymentEndDate: "11302026" }),  // 8106 DECFIN
  rowFor(byKey("G19"), "DECFIN", { ...cyBlock("2026-06-30", 26, 75000), EmploymentEndDate: "" }), // accepted: no event date (Q1); L2 needs none
  L1(97, { PA_CurrentYear: "123456" }),                            // 9519
  L1(98, { EmploymentEndDate: "930202" }),                         // 825 (padded 00930202 -> month 00)
  L1(99, { AnnualizedEarnings_CurrentYear: "1234567", Weeks_CurrentYear: "0.00", LowContributions_CurrentYear: "0.00" }), // 9519
  L1(100, { Weeks_CurrentYear: "-1.234" }),                        // 9519 + 6503 + 9099
);
const l1Rows = mixed.length;

// Support members for L2 rows
const emp0 = (over: Partial<Emp> = {}, years: Array<{ year: number; ae: number; weeks?: number }> = STD) => ftEmp("2015-03-02", years, over);
const L = (k: string, n: number, scenario: string, m: Partial<Member> & { employments: Emp[] }) => add(base(k, n, scenario, m));
const noMdc25 = (over: Partial<Emp> = {}) => ({ pensionAdjustments: pasFor([Y24]), employments: [emp0(over, [Y24])] });

const l2m = {
  b224: L("L-B224", 302, "L B224 two active employments at 0235", { employments: [emp0({ key: "a" }, [Y24]), ftEmp("2024-02-05", [Y25], { key: "b" })] }),
  b109: L("L-B109", 303, "L B109 permanency after event", { pensionAdjustments: [], employments: [emp0({ permanencyDate: "2026-05-01" }, [])] }),
  b192b: L("L-B192b", 304, "L B192b MDC 2025 never received", noMdc25()),
  b19: L("L-B19", 305, "L B19 AE without WSO", { employments: [emp0()] }),
  b31: L("L-B31", 306, "L B31 enrolled Dec 8-31 of execution year", { pensionAdjustments: [], employments: [emp0({ permanencyDate: "2026-12-10" }, [])] }),
  b37: L("L-B37", 307, "L B37 contribution ceiling", { employments: [emp0()] }),
  b38: L("L-B38", 327, "L B38 contribution floor", { employments: [emp0()] }),
  b112d: L("L-B112d", 328, "L B112 retirement initiated, DECFIN submitted", { employments: [emp0({ otherInformation: "RetNotice 2026-06-30", terminationDate: "2026-06-30", terminationCode: "RET" })] }),
  b139: L("L-B139", 329, "L B139 retirement date changed", { employments: [emp0({ otherInformation: "RetNotice 2026-06-30", terminationDate: "2026-06-30", terminationCode: "RET" })] }),
  b53b2: L("L-B53b-2", 330, "L B53b situation 2 (LTD whole year, FARATE)", { pensionAdjustments: pasFor([Y24]), employments: [emp0({ serviceBreaks: [{ type: "LTD", startDate: "2025-01-01", endDate: null }], salaryRates: [{ type: "FARATE", rate: "70000.00", effectiveDate: "2025-01-01" }, { type: "FARATE", rate: "70000.00", effectiveDate: "2026-01-01" }], service: [...emp0({}, [Y24]).service!, ZERO_MDC_2025, { type: "ACW", amount: "0.0027", beginDate: "2025-01-01", endDate: "2025-01-01", paymentDate: "2025-01-01", targetDate: "2025-01-01", indicator: "PRV", summaryAttribute: "ACW factor" }] }, [Y24])] }),
  b40: L("L-B40", 308, "L B40 AE +33%", { pensionAdjustments: pasFor([{ year: 2024, ae: 58000 }, { year: 2025, ae: 60000 }]), employments: [emp0({}, [{ year: 2024, ae: 58000 }, { year: 2025, ae: 60000 }])] }),
  b41: L("L-B41", 309, "L B41 AE +60%", { pensionAdjustments: pasFor([{ year: 2024, ae: 48000 }, { year: 2025, ae: 50000 }]), employments: [emp0({}, [{ year: 2024, ae: 48000 }, { year: 2025, ae: 50000 }])] }),
  b43: L("L-B43", 310, "L B43 AE -10,000", { pensionAdjustments: pasFor([Y24, { year: 2025, ae: 80000 }]), employments: [emp0({}, [Y24, { year: 2025, ae: 80000 }])] }),
  b44: L("L-B44", 311, "L B44 AE -60,000", { pensionAdjustments: pasFor([{ year: 2024, ae: 125000 }, { year: 2025, ae: 130000 }]), employments: [emp0({}, [{ year: 2024, ae: 125000 }, { year: 2025, ae: 130000 }])] }),
  b47: L("L-B47", 312, "L B47 no AE history before 2025, enrolled 2025", { pensionAdjustments: pasFor([{ year: 2025, ae: 140000, weeks: 51.4 }]), employments: [emp0({ permanencyDate: "2025-01-05" }, [{ year: 2025, ae: 140000, weeks: 51.4 }])] }),
  b53a: L("L-B53a", 313, "L B53a PA off by 1000", { employments: [emp0()] }),
  b53b1: L("L-B53b-1", 314, "L B53b situation 1 (LTD starts mid-year, no FARATE)", { employments: [emp0({ serviceBreaks: [{ type: "LTD", startDate: "2026-05-01", endDate: null }] })] }),
  b184a: L("L-B184a", 315, "L B184a previous-year excess", noMdc25()),
  b185: L("L-B185", 316, "L B185 previous-year shortfall within 1 week", noMdc25()),
  b186a: L("L-B186a", 317, "L B186a previous-year shortfall", noMdc25()),
  b186b: L("L-B186b", 318, "L B186b mid-year enrolment shortfall (2025-07-01)", { pensionAdjustments: [], employments: [emp0({ permanencyDate: "2025-07-01" }, [])] }),
  b186c: L("L-B186c", 319, "L B186c mid-year termination shortfall", { employments: [emp0()] }),
  b214: L("L-B214", 320, "L B214 part-time with NCP leave", { employments: [emp0({ employmentType: "PT", typeHistory: [{ type: "PT", effectiveDate: "2015-03-02" }], serviceBreaks: [{ type: "NCP", startDate: "2026-02-01", endDate: "2026-04-30" }] }, [{ year: 2024, ae: 52000, weeks: 26 }, { year: 2025, ae: 54000, weeks: 26 }])], pensionAdjustments: pasFor([{ year: 2024, ae: 52000, weeks: 26 }, { year: 2025, ae: 54000, weeks: 26 }]) }),
  b207: L("L-B207", 321, "L B207 PA already entered today", { pensionAdjustments: [...pasFor(STD), { employerId: "0235", calculationYear: 2026, amount: 7000, calculationDate: "2026-09-30", entryDate: EXEC_DATE }], employments: [emp0()] }),
  b203: L("L-B203", 322, "L B203 status without effective date", { statusEffectiveDate: null, employments: [emp0()] }),
  b205: L("L-B205", 323, "L B205 sub-status without effective date", { subStatus: "NCT", subStatusEffectiveDate: null, employments: [emp0()] }),
  b206: L("L-B206", 324, "L B206 status history already has the event date", { statusHistory: [{ status: "A", effectiveDate: "2015-03-02" }, { status: "A", subStatus: "RHR", effectiveDate: "2026-09-30" }], employments: [emp0()] }),
  b202: L("L-B202", 325, "L B202 duplicate address dates", { addresses: [{ effectiveStartDate: "2026-10-08" }, { effectiveStartDate: "2026-10-08" }], employments: [emp0()] }),
  b184c: L("L-B184c", 326, "L B184c in-year termination excess", { employments: [emp0()] }),
};
const unknown: Member = { ...base("UNKNOWN", 301, "", { employments: [] }) }; // never seeded: B2

const noHigh = (r: Row): Row => ({ ...r, HighContributions_CurrentYear: "" });
l2("1418", rowFor(unknown, "TERFIN", cyBlock("2026-06-30", 26, 75000)));
l2("6279", rowFor(byKey("M17"), "TERFIN", cyBlock("2026-06-30", 26, 75000)));
l2("3001", rowFor(l2m.b224, "TERFIN", cyBlock("2026-06-30", 26, 75000)));
l2("5728", rowFor(byKey("M4"), "TERFIN", cyBlock("2026-06-30", 26, 75000)), rowFor(byKey("M5"), "RETFIN", cyBlock("2026-06-30", 26, 75000)), rowFor(byKey("M6"), "RETFIN", cyBlock("2026-02-28", 8, 76000)));
l2("2953", rowFor(byKey("M13"), "TERFIN", { ...cyBlock("2019-10-15", 41, 63000), ...pyBlock(2018, 52, 62000) }));
l2("7476", rowFor(l2m.b109, "TERFIN", cyBlock("2026-03-31", 12, 70000)));
l2("1616", rowFor(byKey("M3"), "TERFIN", cyBlock("2026-06-30", 26, 78000)));
l2("8112", rowFor(l2m.b112d, "DECFIN", cyBlock("2026-06-30", 26, 75000)));
l2("9075", rowFor(byKey("M1"), "RETFIN", cyBlock("2026-09-30", 38, 78000)));
l2("2492", rowFor(l2m.b139, "RETFIN", cyBlock("2026-07-31", 30, 75000)));
l2("405", rowFor(byKey("M2"), "TERFIN", { ...cyBlock("2026-06-30", 26, 77000), ...pyBlock(2025, 52, 75000) }));
l2("7166", rowFor(l2m.b192b, "TERFIN", cyBlock("2026-06-30", 26, 75000)));
l2("5604", rowFor(byKey("M10"), "TERFIN", { ...cyBlock("2026-06-30", 26, 75000), ...pyBlock(2025, 52, 75000) }));
l2("9815", rowFor(l2m.b19, "TERFIN", { ...cyBlock("2026-06-30", 0, 75000), ...ZERO_CY, AnnualizedEarnings_CurrentYear: "50000" }));
l2("2955", rowFor(byKey("M11"), "TERFIN", { ...cyBlock("2026-09-30", 0, 75000), ...ZERO_CY }));
l2("7309", rowFor(l2m.b31, "TERFIN", { ...cyBlock("2026-12-15", 0, 75000), ...ZERO_CY }));
l2("5001", rowFor(byKey("M12"), "TERFIN", noHigh(cyBlock("2026-09-30", 19, 54000))));
l2("3029", rowFor(l2m.b37, "TERFIN", { ...cyBlock("2026-09-30", 38, 75000), LowContributions_CurrentYear: "6000.00" }));
l2("480", rowFor(l2m.b38, "TERFIN", { ...cyBlock("2026-09-30", 38, 75000), LowContributions_CurrentYear: "3000.00", HighContributions_CurrentYear: "300.00" }));
l2("1238", rowFor(l2m.b40, "TERFIN", cyBlock("2026-09-30", 38, 80000)));
l2("6065", rowFor(l2m.b41, "TERFIN", cyBlock("2026-09-30", 38, 80000)));
l2("5613", rowFor(l2m.b43, "TERFIN", cyBlock("2026-09-30", 38, 70000)));
l2("1646", rowFor(l2m.b44, "TERFIN", cyBlock("2026-09-30", 38, 70000)));
l2("2990", rowFor(l2m.b47, "TERFIN", cyBlock("2026-09-30", 38, 150000)));
l2("2160", rowFor(l2m.b53a, "TERFIN", { ...cyBlock("2026-09-30", 38, 75000), PA_CurrentYear: String(Number(cyBlock("2026-09-30", 38, 75000).PA_CurrentYear) + 1000) }));
l2("7375", rowFor(l2m.b53b1, "TERFIN", { ...cyBlock("2026-09-30", 17, 75000), PA_CurrentYear: "1000" }));
l2("8795", rowFor(l2m.b53b2, "TERFIN", { ...cyBlock("2026-06-30", 0, 75000), ...ZERO_CY, PA_CurrentYear: "5000" }));
l2("66", rowFor(l2m.b184a, "TERFIN", { ...cyBlock("2026-06-30", 26, 75000), ...pyBlock(2025, 53, 75000) }));
l2("3002", rowFor(byKey("M7"), "TERFIN", cyBlock("2026-09-30", 40, 66000)));
l2("7854", rowFor(l2m.b184c, "TERFIN", cyBlock("2026-09-30", 45, 75000)));
l2("3506", rowFor(l2m.b185, "TERFIN", { ...cyBlock("2026-06-30", 26, 75000), ...pyBlock(2025, 51.5, 75000) }));
l2("573", rowFor(l2m.b186a, "TERFIN", { ...cyBlock("2026-06-30", 26, 75000), ...pyBlock(2025, 40, 75000) }));
l2("3466", rowFor(l2m.b186b, "TERFIN", { ...cyBlock("2026-09-30", 38, 75000), ...pyBlock(2025, 10, 75000) }));
l2("9829", rowFor(l2m.b186c, "TERFIN", cyBlock("2026-09-30", 5, 75000)));
l2("9810", rowFor(byKey("M14"), "TERFIN", { ...cyBlock("2026-06-30", 0, 75000), ...ZERO_CY, PA_CurrentYear: "3000" }));
l2("6012", rowFor(l2m.b214, "TERFIN", noHigh(cyBlock("2026-09-30", 38, 54000))));
l2("2153", rowFor(l2m.b207, "TERFIN", cyBlock("2026-09-30", 38, 75000)));
l2("619", rowFor(l2m.b203, "TERFIN", cyBlock("2026-09-30", 38, 75000)), rowFor(l2m.b206, "TERFIN", cyBlock("2026-09-30", 38, 75000)));
l2("1070", rowFor(l2m.b205, "TERFIN", cyBlock("2026-09-30", 38, 75000)));
l2("6908", rowFor(l2m.b202, "TERFIN", cyBlock("2026-09-30", 38, 75000)));
// Filler clean rows to reach 100 (fresh members so I10 never fires)
let filler = 16;
while (mixed.length < 100) {
  const m = byKey(`G${filler++}`);
  const eventDate = m.employments[0].terminationDate ?? "2026-06-30";
  mixed.push(rowFor(m, m.employments[0].terminationCode === "RET" ? "RETFIN" : "TERFIN", cyBlock(eventDate, 20, 73000 + filler * 100)));
}
if (mixed.length !== 100) throw new Error(`mixed has ${mixed.length} rows`);
write("mixed-100-rows", "input.csv", csv(mixed));
const L1_IDS = ["8233", "2031", "9519", "825", "6503", "6642", "5131", "8034", "910", "4999", "9349", "9099", "4423", "4869", "7902", "494", "5049", "8106"];
writeFileSync(
  path.join(root, "mixed-100-rows", "expected-message-ids.json"),
  JSON.stringify({ executionDate: EXEC_DATE, l1MessageIds: L1_IDS, l2MessageIds: Object.keys(expectL2), messageIds: [...L1_IDS, ...Object.keys(expectL2).filter((k) => !L1_IDS.includes(k))], l2RowsByMessageId: expectL2, rows: 100, l1Rows, disabledNotExpected: ["6700"] }, null, 2) + "\n",
);

// ---------------------------------------------------------------------------------------------------------
// Seed file
// ---------------------------------------------------------------------------------------------------------
const seed = {
  $comment: "Generated by tests/golden/generate-fixtures.ts - architecture section 4.6 members M1-M18 plus golden-support members (scenario starts with G or L). Rate tables are placeholders (section 18 Q9).",
  version: 1,
  employers: [
    { employerId: "0235", name: "St. Michael's Healthcare", yearEndClosedIndicator: "2025-12-31" },
    { employerId: "0359", name: "Sisters of St. Joseph's", yearEndClosedIndicator: "2025-12-31" },
    { employerId: "0135", name: "Grand River Hospital", yearEndClosedIndicator: "2025-12-31" },
  ],
  rateTables: placeholderRateRows(),
  members: [...canonical, ...support],
};
const seedPath = path.resolve(root, "..", "fixtures", "ariel-seed.json");
mkdirSync(path.dirname(seedPath), { recursive: true });
writeFileSync(seedPath, JSON.stringify(seed, null, 2) + "\n");
console.log(`wrote tests/fixtures/ariel-seed.json (${seed.members.length} members)`);
console.log("done");