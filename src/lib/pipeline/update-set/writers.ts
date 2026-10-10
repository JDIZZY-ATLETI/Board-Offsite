import { contentHashOf, countBy, sortItems } from "@/lib/derivation/final";
import type { ArielFieldValue, ArielOperation, ArielRecordType, ArielUpdateItemCore, EventType, IsoDate, RawValues, UpdateSetCounts, UpdateSetGoldDocument } from "@/types";
import { csvLine } from "../csv-out";

/** Legacy report names (spec Reports sheet) the UI shows beside ours. */
export const LEGACY_REPORT_NAMES = {
  "modified-fields-report.csv": "D0000upd.xlsx",
  "transactions-report.csv": "D0000tra.xlsx",
  "transactions-summary.csv": "D0000sta.xlsx",
} as const;

export function updateSetCounts(items: ArielUpdateItemCore[]): UpdateSetCounts {
  return {
    byRecordType: countBy(items, (i) => i.recordType) as Partial<Record<ArielRecordType, number>>,
    byOperation: countBy(items, (i) => i.operation) as Partial<Record<ArielOperation, number>>,
    byEventType: countBy(items, (i) => i.eventType) as Partial<Record<EventType, number>>,
  };
}

/** Members in canonical order (sinPseudo, lineNumber) with their items in sortOrder. */
export function groupByMember(items: ArielUpdateItemCore[]): UpdateSetGoldDocument["members"] {
  const sorted = sortItems(items);
  const groups = new Map<string, UpdateSetGoldDocument["members"][number]>();
  for (const it of sorted) {
    const key = `${it.sinPseudo}|${it.lineNumber}`;
    let g = groups.get(key);
    if (!g) {
      g = { sinPseudo: it.sinPseudo, sinMasked: it.sinMasked, memberDisplay: it.memberDisplay, lineNumber: it.lineNumber, eventType: it.eventType, eventDate: it.eventDate, itemCount: 0, items: [] };
      groups.set(key, g);
    }
    g.items.push(it);
    g.itemCount += 1;
  }
  return [...groups.values()];
}

/** Deterministic gold document: no ids, no clocks (architecture section 15 golden files). */
export function buildGoldDocument(items: ArielUpdateItemCore[], meta: { employerId: string; executionDate: IsoDate }): UpdateSetGoldDocument {
  const members = groupByMember(items);
  return {
    schemaVersion: 1,
    employerId: meta.employerId,
    executionDate: meta.executionDate,
    contentHash: contentHashOf(items),
    itemCount: items.length,
    memberCount: members.length,
    counts: updateSetCounts(items),
    members,
  };
}

export function renderGoldJson(doc: UpdateSetGoldDocument): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

function cell(v: ArielFieldValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

const ITEM_CSV_HEADER = ["member", "line", "eventType", "eventDate", "recordType", "operation", "yearScope", "derivationRule", "field", "before", "after", "sourceFields", "targetKey"];

/** One row per item field (DELETE items list their before-values). */
export function renderUpdateSetCsv(items: ArielUpdateItemCore[]): string {
  const lines = [csvLine(ITEM_CSV_HEADER)];
  for (const m of groupByMember(items)) {
    for (const it of m.items) {
      const fieldNames = Object.keys(it.fields).length ? Object.keys(it.fields) : Object.keys(it.before ?? {});
      for (const f of fieldNames) {
        lines.push(csvLine([it.memberDisplay, String(it.lineNumber), it.eventType, it.eventDate, it.recordType, it.operation, it.yearScope ?? "", it.derivationRule, f, cell(it.before?.[f]), it.operation === "DELETE" ? "" : cell(it.fields[f]), it.sourceFields.join(" "), JSON.stringify(it.targetKey)]));
      }
    }
  }
  return lines.join("\r\n") + "\r\n";
}

const RECORD_TYPE_LABEL: Record<ArielRecordType, string> = {
  Employment: "Employment",
  Member: "Member",
  TransactionsServiceBreak: "Transactions / Service Break",
  TransactionsService: "Transactions / Service",
  TransactionsContributions: "Transactions / Contributions",
  TransactionsSalaryRates: "Transactions / Salary Rates",
  PlansTaxInfoPA: "Plans / Tax Info / PA",
  MembershipStatus: "Membership status",
  CalculationsBenefit: "Calculations / Benefit",
  CalculationIndicator: "Calculation indicator",
  BenefitReevaluationFlag: "Benefit re-evaluation flag",
};

function md(v: ArielFieldValue | undefined): string {
  const s = cell(v);
  return s === "" ? "—" : s.replace(/\|/g, "\\|");
}

/** Human-readable before/after per member and record type (gold/diff.md). */
export function renderDiffMd(doc: UpdateSetGoldDocument): string {
  const out: string[] = [];
  out.push(`# Ariel Update Set — employer ${doc.employerId}`, "");
  out.push(`- Execution date: ${doc.executionDate}`, `- Content hash: \`${doc.contentHash}\``, `- Members: ${doc.memberCount} · Items: ${doc.itemCount}`, "");
  const rt = Object.entries(doc.counts.byRecordType).map(([k, v]) => `${RECORD_TYPE_LABEL[k as ArielRecordType]} ${v}`);
  const op = Object.entries(doc.counts.byOperation).map(([k, v]) => `${k} ${v}`);
  out.push(`- By record type: ${rt.join(" · ") || "none"}`, `- By operation: ${op.join(" · ") || "none"}`, "");
  if (doc.members.length === 0) out.push("_No Ariel changes — every row was rejected._", "");
  for (const m of doc.members) {
    out.push(`## ${m.memberDisplay} — ${m.eventType} ${m.eventDate} (line ${m.lineNumber}, ${m.itemCount} items)`, "");
    let currentType: string | null = null;
    for (const it of m.items) {
      if (it.recordType !== currentType) {
        currentType = it.recordType;
        out.push(`### ${RECORD_TYPE_LABEL[it.recordType]}`, "");
      }
      out.push(`**${it.operation}** \`${it.derivationRule}\`${it.yearScope ? ` (${it.yearScope === "CURRENT" ? "CY" : "PY"})` : ""} — ${it.explanation}`, "");
      const fieldNames = Object.keys(it.fields).length ? Object.keys(it.fields) : Object.keys(it.before ?? {});
      if (fieldNames.length) {
        out.push("| Field | Before | After |", "|---|---|---|");
        for (const f of fieldNames) out.push(`| ${f} | ${md(it.before?.[f])} | ${it.operation === "DELETE" ? "_(deleted)_" : md(it.fields[f])} |`);
        out.push("");
      }
    }
  }
  return out.join("\n");
}

/** The file cell a field was derived from (first source column), for the Modified Fields report. */
function fileValueFor(it: ArielUpdateItemCore, field: string, raw: RawValues | undefined): string {
  const primary: Record<string, string[]> = {
    terminationDate: ["EmploymentEndDate", "DateOfDeath"],
    dateOfDeath: ["DateOfDeath", "EmploymentEndDate"],
    otherInformation: ["EmploymentEndDate", "DateOfDeath"],
    terminationCode: ["EventType"],
    amount: it.sourceFields.slice(0, 1),
    rate: it.sourceFields.slice(0, 1),
    pensionAdjustment: it.sourceFields.slice(0, 1),
    eventCategory: ["EventType"],
    statusCode: ["EventType"],
  };
  const cols = primary[field];
  if (!cols || !raw) return "";
  for (const c of cols) {
    if (it.sourceFields.includes(c as never)) {
      const v = (raw as Record<string, string | null | undefined>)[c];
      if (v != null) return v;
    }
  }
  return "";
}

/** Legacy D0000upd: one row per updated field with file value, previous Ariel value and resulting value. */
export function renderModifiedFieldsReport(items: ArielUpdateItemCore[], rawByLine: Map<number, RawValues>): string {
  const lines = [csvLine(["member", "line", "eventType", "eventDate", "recordType", "operation", "field", "fileValue", "previousArielValue", "resultingValue", "derivationRule", "sourceFields"])];
  for (const m of groupByMember(items)) {
    for (const it of m.items) {
      const fieldNames = Object.keys(it.fields).length ? Object.keys(it.fields) : Object.keys(it.before ?? {});
      for (const f of fieldNames) {
        lines.push(csvLine([it.memberDisplay, String(it.lineNumber), it.eventType, it.eventDate, it.recordType, it.operation, f, fileValueFor(it, f, rawByLine.get(it.lineNumber)), cell(it.before?.[f]), it.operation === "DELETE" ? "" : cell(it.fields[f]), it.derivationRule, it.sourceFields.join(" ")]));
      }
    }
  }
  return lines.join("\r\n") + "\r\n";
}

const TX_TYPES: ReadonlySet<ArielRecordType> = new Set(["TransactionsService", "TransactionsContributions", "TransactionsSalaryRates", "PlansTaxInfoPA"]);

function txAmount(it: ArielUpdateItemCore): string {
  return cell(it.fields.amount ?? it.fields.rate ?? it.fields.pensionAdjustment);
}
function txType(it: ArielUpdateItemCore): string {
  return cell(it.fields.type ?? it.fields.salaryRateType ?? (it.recordType === "PlansTaxInfoPA" ? "PA" : ""));
}

/** Legacy D0000tra: every Service/Contribution/Salary/PA item per member with dates and amounts. */
export function renderTransactionsReport(items: ArielUpdateItemCore[]): string {
  const lines = [csvLine(["member", "line", "eventType", "eventDate", "recordType", "transactionType", "indicator", "yearScope", "operation", "existingAmount", "fileAmount", "resultingAmount", "beginDate", "endDate", "paymentDate", "targetDate", "declarationDate", "effectiveDate", "calculationYear", "derivationRule"])];
  for (const m of groupByMember(items)) {
    for (const it of m.items) {
      if (!TX_TYPES.has(it.recordType)) continue;
      lines.push(
        csvLine([
          it.memberDisplay,
          String(it.lineNumber),
          it.eventType,
          it.eventDate,
          it.recordType,
          txType(it),
          cell(it.fields.transactionIndicator),
          it.yearScope ?? "",
          it.operation,
          cell(it.calculated?.existingAmount ?? it.before?.amount),
          cell(it.calculated?.fileAmount ?? (it.operation === "CREATE" ? it.fields.amount : undefined)),
          txAmount(it),
          cell(it.fields.beginDate),
          cell(it.fields.endDate),
          cell(it.fields.paymentDate),
          cell(it.fields.targetDate),
          cell(it.fields.declarationDate),
          cell(it.fields.effectiveDate),
          cell(it.fields.calculationYear),
          it.derivationRule,
        ]),
      );
    }
  }
  return lines.join("\r\n") + "\r\n";
}

/** Legacy D0000sta: totals by record type / transaction type / indicator, then row outcomes. */
export function renderTransactionsSummary(items: ArielUpdateItemCore[], outcomes: { rows: number; accepted: number; rejected: number; held: number }): string {
  const lines = [csvLine(["section", "recordType", "transactionType", "indicator", "operation", "count", "totalAmount"])];
  const agg = new Map<string, { count: number; total: number; parts: string[] }>();
  for (const it of items) {
    if (!TX_TYPES.has(it.recordType)) continue;
    const parts = [it.recordType, txType(it), cell(it.fields.transactionIndicator), it.operation];
    const k = parts.join("|");
    const a = agg.get(k) ?? { count: 0, total: 0, parts };
    a.count += 1;
    a.total += Number(txAmount(it) || 0);
    agg.set(k, a);
  }
  for (const [, a] of [...agg.entries()].sort(([x], [y]) => x.localeCompare(y))) lines.push(csvLine(["transactions", ...a.parts, String(a.count), a.total.toFixed(2)]));
  for (const [rt, n] of Object.entries(countBy(items, (i) => i.recordType))) lines.push(csvLine(["items-by-record-type", rt, "", "", "", String(n), ""]));
  lines.push(csvLine(["rows", "", "", "", "accepted", String(outcomes.accepted), ""]));
  lines.push(csvLine(["rows", "", "", "", "rejected", String(outcomes.rejected), ""]));
  lines.push(csvLine(["rows", "", "", "", "held", String(outcomes.held), ""]));
  lines.push(csvLine(["rows", "", "", "", "total", String(outcomes.rows), ""]));
  return lines.join("\r\n") + "\r\n";
}