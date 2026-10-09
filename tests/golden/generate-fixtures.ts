/**
 * Deterministic generator for the golden input files. Re-run with `npx tsx tests/golden/generate-fixtures.ts`.
 * SINs are synthetic (9xx range, Luhn-valid unless a scenario needs otherwise); names are synthetic.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { EVENTS_CSV_COLUMNS } from "../../src/types/events";
import { withLuhnCheckDigit } from "../../src/lib/pii/sin";

const HEADER = EVENTS_CSV_COLUMNS.join(",");
const root = path.resolve(__dirname);

function sin(n: number): string {
  return withLuhnCheckDigit(String(90000000 + n));
}

type Row = Partial<Record<(typeof EVENTS_CSV_COLUMNS)[number], string>>;

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

const terfin = (i: number, over: Row = {}): Row => ({
  SIN: sin(i),
  LastName: ["ABLE", "BAKER", "CHEN", "DIAZ", "EVANS", "FOX", "GREY", "HALL", "IRWIN", "JONES"][i % 10],
  FirstName: ["Anna", "Ben", "Carol", "Dan", "Eve", "Frank", "Gina", "Hugo", "Ida", "Jack"][i % 10],
  EventType: "TERFIN",
  EmploymentEndDate: `0${(i % 9) + 1}${String(10 + (i % 18)).padStart(2, "0")}2026`,
  Weeks_CurrentYear: (20 + (i % 20)).toFixed(2),
  LowContributions_CurrentYear: (1500 + i * 13.37).toFixed(2),
  HighContributions_CurrentYear: i % 3 === 0 ? "" : (200 + i * 2.5).toFixed(2),
  AnnualizedEarnings_CurrentYear: "",
  PA_CurrentYear: String(6000 + i * 37),
  Weeks_PreviousYear: i % 4 === 0 ? "" : "52.00",
  LowContributions_PreviousYear: i % 4 === 0 ? "" : (2600 + i * 11).toFixed(2),
  HighContributions_PreviousYear: i % 4 === 0 ? "" : (400 + i).toFixed(2),
  AnnualizedEarnings_PreviousYear: "",
  PA_PreviousYear: i % 4 === 0 ? "" : String(11000 + i * 41),
  ...over,
});

// ---- happy-terfin: 5 valid TERFIN rows, one name with a windows-1252 accented character
write("happy-terfin", "input.csv", csv([
  terfin(1, { LastName: "C\u00d4T\u00c9", FirstName: "Ren\u00e9e" }),
  terfin(2),
  terfin(3),
  terfin(4, { Weeks_PreviousYear: "0.00", LowContributions_PreviousYear: "0.00", HighContributions_PreviousYear: "", PA_PreviousYear: "0" }),
  terfin(5, { Weeks_CurrentYear: "0.00", LowContributions_CurrentYear: "0.00", HighContributions_CurrentYear: "", PA_CurrentYear: "0" }),
]));

// ---- happy-decfin: DECFIN rows; the CSV has no DateOfDeath column so EmploymentEndDate carries the date (Q1)
write("happy-decfin", "input.csv", csv([
  terfin(11, { EventType: "DECFIN", EmploymentEndDate: "03152026" }),
  terfin(12, { EventType: "DECFIN", EmploymentEndDate: "07012026" }),
  terfin(13, { EventType: "DECFIN", EmploymentEndDate: "09302026", Weeks_PreviousYear: "", LowContributions_PreviousYear: "", HighContributions_PreviousYear: "", PA_PreviousYear: "" }),
]));

// ---- happy-retfin
write("happy-retfin", "input.csv", csv([
  terfin(21, { EventType: "RETFIN", EmploymentEndDate: "06302026" }),
  terfin(22, { EventType: "RETFIN", EmploymentEndDate: "01312026" }),
  terfin(23, { EventType: "RETFIN", EmploymentEndDate: "08312026", Weeks_CurrentYear: "0.00", LowContributions_CurrentYear: "0.00", HighContributions_CurrentYear: "", AnnualizedEarnings_CurrentYear: "48000", PA_CurrentYear: "0" }),
]));

// ---- file-rejected-header: typo in a mandatory column name -> I51 / 4887
write("file-rejected-header", "input.csv", csv([terfin(31), terfin(32)], HEADER.replace("LastName", "LastNme")));

// ---- file-rejected-extra-values: a data row with more cells than the header -> I50 / 130
write("file-rejected-extra-values", "input.csv", [HEADER, line(terfin(41)), line(terfin(42)) + ",EXTRA", line(terfin(43))].join("\r\n") + "\r\n");

// ---- mixed-100-rows: rows 1-60 valid; rows 61-100 exercise every L1 message id at least once
const mixed: Row[] = [];
for (let i = 1; i <= 60; i++) {
  mixed.push(terfin(100 + i, i % 7 === 0 ? { EventType: "RETFIN" } : i % 11 === 0 ? { EventType: "DECFIN" } : {}));
}
const bad = (over: Row, i: number) => terfin(200 + i, over);
mixed.push(
  bad({ LastName: "" }, 61),                                        // 8233
  bad({ FirstName: "" }, 62),                                       // 8233
  bad({ EventType: "" }, 63),                                       // 8233
  bad({ EmploymentEndDate: "" }, 64),                               // 8233 (TERFIN)
  bad({ Weeks_CurrentYear: "" }, 65),                               // 8233
  bad({ LowContributions_CurrentYear: "" }, 66),                    // 8233
  bad({ PA_CurrentYear: "" }, 67),                                  // 8233
  bad({ SIN: "" }, 68),                                             // 2031
  bad({ Weeks_CurrentYear: "123.45" }, 69),                         // 9519
  bad({ LowContributions_CurrentYear: "123456.78" }, 70),           // 9519
  bad({ EmploymentEndDate: "13312026" }, 71),                       // 825
  bad({ EmploymentEndDate: "2026-09-30" }, 72),                     // 825
  bad({ Weeks_CurrentYear: "38.123" }, 73),                         // 6503 (+9519)
  bad({ LowContributions_PreviousYear: "12.345" }, 74),             // 6642
  bad({ LowContributions_CurrentYear: "abc" }, 75),                 // 6503
  bad({ PA_CurrentYear: "12.5" }, 76),                              // 5131
  bad({ AnnualizedEarnings_PreviousYear: "-100", Weeks_PreviousYear: "", LowContributions_PreviousYear: "", HighContributions_PreviousYear: "" }, 77), // 5131
  bad({ SIN: "12345678X" }, 78),                                    // 5131 (masked)
  bad({ EventType: "RETIRE" }, 79),                                 // 8034
  bad({ SIN: sin(999) }, 80),                                       // 910
  bad({ SIN: sin(999) }, 81),                                       // 910
  bad({ AnnualizedEarnings_CurrentYear: "52000" }, 82),             // 4999 CURRENT
  bad({ AnnualizedEarnings_PreviousYear: "60000" }, 83),            // 4999 PREVIOUS
  bad({ LowContributions_CurrentYear: "0" }, 84),                   // 9349 CURRENT
  bad({ LowContributions_PreviousYear: "0.00" }, 85),               // 9349 PREVIOUS
  bad({ Weeks_CurrentYear: "-1.00" }, 86),                          // 9099
  bad({ LowContributions_CurrentYear: "-5" }, 87),                  // 4423
  bad({ HighContributions_CurrentYear: "-0.01" }, 88),              // 4869
  bad({ Weeks_PreviousYear: "-2" }, 89),                            // 7902
  bad({ LowContributions_PreviousYear: "-3.50" }, 90),              // 494
  bad({ HighContributions_PreviousYear: "-1" }, 91),                // 5049
  bad({ EmploymentEndDate: "12312027" }, 92),                       // 8106 TERFIN
  bad({ EventType: "RETFIN", EmploymentEndDate: "01012027" }, 93),  // 8106 RETFIN (Q5)
  bad({ EventType: "DECFIN", EmploymentEndDate: "11302026" }, 94),  // 8106 DECFIN
  bad({ EventType: "DECFIN", EmploymentEndDate: "" }, 95),          // accepted: EmploymentEndDate not mandatory for DECFIN (Q1)
  bad({ EventType: "RETFIN" }, 96),                                 // accepted
  bad({ PA_CurrentYear: "123456" }, 97),                            // 9519
  bad({ EmploymentEndDate: "930202" }, 98),                         // 825 (padded 00930202 -> month 00)
  bad({ AnnualizedEarnings_CurrentYear: "1234567", Weeks_CurrentYear: "0.00", LowContributions_CurrentYear: "0.00" }, 99), // 9519
  bad({ Weeks_CurrentYear: "-1.234" }, 100),                        // 9519 + 6503 + 9099
);
write("mixed-100-rows", "input.csv", csv(mixed));
writeFileSync(
  path.join(root, "mixed-100-rows", "expected-message-ids.json"),
  JSON.stringify(
    {
      executionDate: "2026-10-08",
      messageIds: ["8233", "2031", "9519", "825", "6503", "6642", "5131", "8034", "910", "4999", "9349", "9099", "4423", "4869", "7902", "494", "5049", "8106"],
      rows: 100,
      accepted: 62,
      rejected: 38,
      rejectedLines: Array.from({ length: 40 }, (_, k) => 62 + k).filter((l) => l !== 96 && l !== 97),
    },
    null,
    2,
  ) + "\n",
);
console.log("done");
