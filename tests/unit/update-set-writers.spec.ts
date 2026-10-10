import { describe, expect, it } from "vitest";
import { csvExportFormat, EXPORT_FORMATS, formatsFor, jsonExportFormat, type ExportPayload } from "@/lib/export";
import { buildGoldDocument, groupByMember, renderDiffMd, renderGoldJson, renderModifiedFieldsReport, renderTransactionsReport, renderTransactionsSummary, renderUpdateSetCsv, updateSetCounts } from "@/lib/pipeline/update-set/writers";
import type { ArielUpdateItemCore, RawValues } from "@/types";

const base = (over: Partial<ArielUpdateItemCore>): ArielUpdateItemCore => ({
  sinPseudo: "b".repeat(64),
  sinMasked: "***-***-019",
  memberDisplay: "***-***-019 ABLE, Anna",
  employerId: "0235",
  lineNumber: 2,
  eventType: "TERFIN",
  eventDate: "2026-09-30",
  recordType: "Employment",
  operation: "UPDATE",
  yearScope: null,
  targetKey: { employmentId: "emp-1" },
  fields: { terminationDate: "2026-09-30" },
  before: { terminationDate: null },
  sourceFields: ["EmploymentEndDate"],
  derivationRule: "D-EMP-TERMDATE",
  explanation: "x",
  calculated: null,
  sortOrder: 0,
  ...over,
});

const items: ArielUpdateItemCore[] = [
  base({}),
  base({ sortOrder: 1, recordType: "TransactionsService", operation: "UPSERT_ADD", yearScope: "CURRENT", targetKey: { employmentId: "emp-1", type: "CTSRV" }, fields: { type: "CTSRV", amount: "43.00", transactionIndicator: "PRV", beginDate: "2026-01-01", endDate: "2026-09-30", paymentDate: "2026-09-30", targetDate: "2026-09-30", declarationDate: "2026-09-30" }, before: { amount: "5.00" }, sourceFields: ["Weeks_CurrentYear"], derivationRule: "D-SRV-CTSRV-CY", calculated: { existingAmount: "5.00", fileAmount: "38.00", resultAmount: "43.00" } }),
  base({ sortOrder: 2, recordType: "TransactionsServiceBreak", operation: "DELETE", targetKey: { employmentId: "emp-1", breakId: "brk-1" }, fields: {}, before: { type: "NCM", startDate: "2026-11-01", endDate: "2026-12-15" }, derivationRule: "D-BRK-DELETE" }),
  base({ sortOrder: 3, recordType: "PlansTaxInfoPA", operation: "CREATE", yearScope: "CURRENT", targetKey: { memberId: "m" }, fields: { pensionAdjustment: 7368, calculationYear: 2026 }, before: null, sourceFields: ["PA_CurrentYear"], derivationRule: "D-PA-CY" }),
  // second member sorts first by pseudonym; its "name" is a formula-injection probe
  base({ sinPseudo: "a".repeat(64), sinMasked: "***-***-027", memberDisplay: "=HYPERLINK(\"x\") ***-***-027", lineNumber: 3, eventType: "DECFIN", fields: { terminationDate: "2026-07-01" } }),
];
const raw = new Map<number, RawValues>([[2, { SIN: "***", LastName: "ABLE", FirstName: "Anna", EventType: "TERFIN", EmploymentEndDate: "09302026", Weeks_CurrentYear: "38.00", LowContributions_CurrentYear: "1", HighContributions_CurrentYear: null, AnnualizedEarnings_CurrentYear: null, PA_CurrentYear: "7368", Weeks_PreviousYear: null, LowContributions_PreviousYear: null, HighContributions_PreviousYear: null, AnnualizedEarnings_PreviousYear: null, PA_PreviousYear: null }]]);

describe("update-set writers", () => {
  it("gold document is canonical: members sorted by pseudonym, counts by type/operation/event, hash over sorted items, no ids", () => {
    const doc = buildGoldDocument(items, { employerId: "0235", executionDate: "2026-10-08" });
    expect(doc.members.map((m) => m.sinMasked)).toEqual(["***-***-027", "***-***-019"]);
    expect(doc.memberCount).toBe(2);
    expect(doc.itemCount).toBe(5);
    expect(doc.counts.byOperation).toEqual({ CREATE: 1, DELETE: 1, UPDATE: 2, UPSERT_ADD: 1 });
    expect(doc.counts.byEventType).toEqual({ DECFIN: 1, TERFIN: 4 });
    expect(doc.contentHash).toBe(buildGoldDocument([...items].reverse(), { employerId: "0235", executionDate: "2026-10-08" }).contentHash);
    const json = renderGoldJson(doc);
    expect(json.endsWith("\n")).toBe(true);
    expect(json).not.toMatch(/"itemId"|"updateSetId"|"ledgerEntryId"|"recordId"/);
    expect(updateSetCounts(items).byRecordType.Employment).toBe(2);
    expect(groupByMember(items)[1].items.map((i) => i.sortOrder)).toEqual([0, 1, 2, 3]);
  });
  it("CSV outputs are formula-injection hardened and list DELETE before-values", () => {
    const csv = renderUpdateSetCsv(items);
    expect(csv.split("\r\n")[0]).toBe("member,line,eventType,eventDate,recordType,operation,yearScope,derivationRule,field,before,after,sourceFields,targetKey");
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\") ***-***-027\"");
    expect(csv).toMatch(/TransactionsServiceBreak,DELETE,,D-BRK-DELETE,type,NCM,,/);
    expect(csv).toMatch(/TransactionsService,UPSERT_ADD,CURRENT,D-SRV-CTSRV-CY,amount,5\.00,43\.00,Weeks_CurrentYear/);
    const mod = renderModifiedFieldsReport(items, raw);
    expect(mod).toMatch(/Employment,UPDATE,terminationDate,09302026,,2026-09-30,D-EMP-TERMDATE,EmploymentEndDate/);
    expect(mod).toMatch(/TransactionsService,UPSERT_ADD,amount,38\.00,5\.00,43\.00,D-SRV-CTSRV-CY/);
    expect(mod).toMatch(/PlansTaxInfoPA,CREATE,pensionAdjustment,7368,,7368,D-PA-CY/);
    const tx = renderTransactionsReport(items);
    expect(tx.split("\r\n").filter(Boolean)).toHaveLength(3); // header + CTSRV + PA
    expect(tx).toMatch(/TransactionsService,CTSRV,PRV,CURRENT,UPSERT_ADD,5\.00,38\.00,43\.00,2026-01-01,2026-09-30/);
    const sum = renderTransactionsSummary(items, { rows: 3, accepted: 2, rejected: 1, held: 0 });
    expect(sum).toContain("transactions,TransactionsService,CTSRV,PRV,UPSERT_ADD,1,43.00");
    expect(sum).toContain("transactions,PlansTaxInfoPA,PA,,CREATE,1,7368.00");
    expect(sum).toContain("rows,,,,accepted,2,");
  });
  it("diff.md renders a heading per member, a section per record type, before/after tables and the deleted marker", () => {
    const md = renderDiffMd(buildGoldDocument(items, { employerId: "0235", executionDate: "2026-10-08" }));
    expect(md).toContain("## ***-***-019 ABLE, Anna — TERFIN 2026-09-30 (line 2, 4 items)");
    expect(md).toContain("### Transactions / Service Break");
    expect(md).toContain("| terminationDate | — | 2026-09-30 |");
    expect(md).toContain("| type | NCM | _(deleted)_ |");
    expect(renderDiffMd(buildGoldDocument([], { employerId: "0235", executionDate: "2026-10-08" }))).toContain("_No Ariel changes");
  });
});

describe("ArielExportFormat", () => {
  const payload: ExportPayload = {
    schemaVersion: 1,
    exportId: "e1",
    updateSetId: "u1",
    batchId: "b1",
    employerId: "0235",
    executionDate: "2026-10-08",
    contentHash: "c".repeat(64),
    exportedAt: "2026-10-08T12:00:00.000Z",
    exportedBy: "user:rev",
    itemCount: 2,
    memberCount: 1,
    members: [{ sin: "900000019", sinMasked: "***-***-019", sinPseudo: "b".repeat(64), lastName: "ABLE", firstName: "=Anna", employerId: "0235", lineNumber: 2, eventType: "TERFIN", eventDate: "2026-09-30", items: items.slice(0, 2) }],
  };
  it("json carries the raw SIN for the loader; csv has one row per field with SIN first and hardened cells", () => {
    const json = JSON.parse(jsonExportFormat.render(payload).toString("utf8"));
    expect(json.members[0].sin).toBe("900000019");
    expect(json.contentHash).toBe("c".repeat(64));
    const csv = csvExportFormat.render(payload).toString("utf8").split("\r\n");
    expect(csv[0]).toBe("SIN,LastName,FirstName,EmployerId,EventType,EventDate,Line,RecordType,Operation,YearScope,DerivationRule,TargetKey,Field,Before,After");
    expect(csv[1]).toMatch(/^900000019,ABLE,'=Anna,0235,TERFIN,2026-09-30,2,Employment,UPDATE,,D-EMP-TERMDATE,/);
    expect(csv.filter(Boolean)).toHaveLength(1 + 1 + 8);
  });
  it("formatsFor resolves json | csv | both; the registry is the extension point for a real APX layout", () => {
    expect(formatsFor("both").map((f) => f.id)).toEqual(["json", "csv"]);
    expect(formatsFor("csv").map((f) => f.filename)).toEqual(["ariel-update-set.csv"]);
    expect(Object.keys(EXPORT_FORMATS)).toEqual(["json", "csv"]);
    for (const f of Object.values(EXPORT_FORMATS)) expect(f.contentType).toBeTruthy();
  });
});