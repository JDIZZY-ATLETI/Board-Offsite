import Decimal from "decimal.js";
import type { ArielBatchSnapshot } from "@/lib/ariel/snapshot";
import { canonicalize } from "@/lib/crypto/canonical";
import { sha256Hex } from "@/lib/crypto/hash";
import { addDays, yearOf } from "@/lib/rules/lib/dates";
import { deriveProvisional, SUMMARY_FINAL_DATA, type FileDerived, type ScopeDerived } from "@/lib/derivation/provisional";
import type {
  AnyCsvColumn,
  ArielContributionTx,
  ArielEmployment,
  ArielFieldMap,
  ArielMemberSnapshot,
  ArielOperation,
  ArielRecordType,
  ArielServiceTx,
  ArielUpdateItemCore,
  DecimalString,
  DerivationNote,
  EventsRecord,
  EventType,
  IsoDate,
  YearScope,
} from "@/types";
import { computeContributionSplit, money, type ContributionSplitResult } from "./contributionSplit";

/** Section 8.11 / Special Cases sheet: disability breaks untouched on TERFIN. */
export const DISABILITY_BREAK_TYPES: ReadonlySet<string> = new Set(["DTO", "DTP", "DPR", "DMA", "DMB", "DMS"]);
/** Section 8.6 / section 18 Q13. */
export const CHG_RET_EED = "CHG_RET_EED";
export const INFO_RET_DNCT = "INFO-RET-DNCT";

export interface FinalDerivationInput {
  record: EventsRecord;
  snapshot: ArielBatchSnapshot;
  employerId: string;
  executionDate: IsoDate;
  /** B139 fired on this row and was overridden (section 8.6). */
  b139Overridden?: boolean;
}

export interface FinalDerivation {
  derived: FileDerived;
  items: ArielUpdateItemCore[];
  notes: DerivationNote[];
  membershipStatus: { status: string; subStatus: string | null; effectiveDate: IsoDate } | null;
  employmentTermination: { terminationDate: IsoDate; terminationCode: string | null } | null;
  contributionSplits: Partial<Record<YearScope, ContributionSplitResult>>;
}

export function mmddyyyy(d: IsoDate): string {
  return `${d.slice(5, 7)}${d.slice(8, 10)}${d.slice(0, 4)}`;
}

function scopeSuffix(scope: YearScope): "CY" | "PY" {
  return scope === "CURRENT" ? "CY" : "PY";
}

function col(scope: YearScope, base: "Weeks" | "LowContributions" | "HighContributions" | "AnnualizedEarnings" | "PA"): AnyCsvColumn {
  return `${base}_${scope === "CURRENT" ? "CurrentYear" : "PreviousYear"}` as AnyCsvColumn;
}

type Tx = ArielServiceTx | ArielContributionTx;

function sameKey(tx: Tx, key: { type: string; indicator: string; summaryAttribute: string; beginDate: IsoDate; endDate: IsoDate; paymentDate: IsoDate; targetDate: IsoDate }): boolean {
  return tx.type === key.type && tx.indicator === key.indicator && tx.summaryAttribute === key.summaryAttribute && tx.beginDate === key.beginDate && tx.endDate === key.endDate && tx.paymentDate === key.paymentDate && tx.targetDate === key.targetDate;
}

function sum(list: Array<{ amount: DecimalString }>): Decimal {
  return list.reduce((acc, t) => acc.plus(t.amount), new Decimal(0));
}

function contributionsIn(emp: ArielEmployment, year: number, type: ArielContributionTx["type"], indicator: ArielContributionTx["indicator"]): ArielContributionTx[] {
  // R16: by year of payment date (section 8.8).
  return emp.contributions.filter((c) => c.type === type && c.indicator === indicator && yearOf(c.paymentDate) === year);
}

/** Latest posted PA for the year at the reporting employer, or null. */
export function arielPaFor(member: ArielMemberSnapshot, employerId: string, year: number): number | null {
  const list = member.pensionAdjustments.filter((p) => p.employerId === employerId && p.calculationYear === year).sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.paId.localeCompare(a.paId));
  return list.length ? list[0].amount : null;
}

class ItemBuilder {
  readonly items: ArielUpdateItemCore[] = [];
  constructor(
    private readonly base: Pick<ArielUpdateItemCore, "sinPseudo" | "sinMasked" | "memberDisplay" | "employerId" | "lineNumber" | "eventType" | "eventDate">,
  ) {}
  push(p: {
    recordType: ArielRecordType;
    operation: ArielOperation;
    yearScope?: YearScope | null;
    targetKey: ArielFieldMap;
    fields: ArielFieldMap;
    before?: ArielFieldMap | null;
    sourceFields: AnyCsvColumn[];
    derivationRule: string;
    explanation: string;
    calculated?: ArielFieldMap | null;
  }): void {
    this.items.push({
      ...this.base,
      recordType: p.recordType,
      operation: p.operation,
      yearScope: p.yearScope ?? null,
      targetKey: p.targetKey,
      fields: p.fields,
      before: p.before ?? null,
      sourceFields: p.sourceFields,
      derivationRule: p.derivationRule,
      explanation: p.explanation,
      calculated: p.calculated ?? null,
      sortOrder: this.items.length,
    });
  }
}

/**
 * Final derivation (architecture section 8, complete): one accepted row + its Ariel snapshot -> ordered
 * `ArielUpdateItemCore`s (section 8.13 order). Pure function of (record, snapshot, employerId, executionDate,
 * b139Overridden). Returns null when the provisional derivation cannot locate the member/employment.
 */
export function deriveFinal(input: FinalDerivationInput): FinalDerivation | null {
  const { record, snapshot, employerId, executionDate } = input;
  const d = deriveProvisional(record, snapshot, employerId, executionDate);
  if (!d || !record.sinPseudo || !record.sinMasked || !record.eventType) return null;
  const eventType: EventType = record.eventType;
  const emp = d.employment;
  const member = d.member;
  const eventDate = d.eventDate;
  const dateSource: AnyCsvColumn = eventType === "DECFIN" && record.rawValues.DateOfDeath != null ? "DateOfDeath" : "EmploymentEndDate";
  const notes: DerivationNote[] = [];
  const b = new ItemBuilder({
    sinPseudo: record.sinPseudo,
    sinMasked: record.sinMasked,
    memberDisplay: `${record.sinMasked} ${[record.lastName, record.firstName].filter((s) => s && s.trim()).join(", ")}`.trim(),
    employerId,
    lineNumber: record.lineNumber,
    eventType,
    eventDate,
  });
  const empKey: ArielFieldMap = { employmentId: emp.employmentId };
  const memberKey: ArielFieldMap = { memberId: member.memberId };

  // ---- 8.2 Employment ----
  b.push({
    recordType: "Employment",
    operation: "UPDATE",
    targetKey: empKey,
    fields: { terminationDate: eventDate },
    before: { terminationDate: emp.terminationDate },
    sourceFields: [dateSource],
    derivationRule: "D-EMP-TERMDATE",
    explanation: `Employment.terminationDate = ${eventType === "DECFIN" ? "DateOfDeath" : "EmploymentEndDate"} (${eventDate})${emp.terminationDate ? `; Ariel had ${emp.terminationDate}` : ""}`,
  });
  let terminationCode: string | null = emp.terminationCode;
  if (eventType !== "RETFIN") {
    terminationCode = eventType === "TERFIN" ? "TER" : "DEC";
    b.push({
      recordType: "Employment",
      operation: "UPDATE",
      targetKey: empKey,
      fields: { terminationCode },
      before: { terminationCode: emp.terminationCode },
      sourceFields: ["EventType"],
      derivationRule: "D-EMP-TERMCODE",
      explanation: `Employment.terminationCode = "${terminationCode}" because EventType = ${eventType}`,
    });
  }
  const otherInformation = `Events ${mmddyyyy(eventDate)}`;
  b.push({
    recordType: "Employment",
    operation: "UPDATE",
    targetKey: empKey,
    fields: { otherInformation },
    before: { otherInformation: emp.otherInformation },
    sourceFields: [dateSource],
    derivationRule: "D-EMP-OTHERINFO",
    explanation: `Employment.otherInformation = "Events " + ${eventType === "DECFIN" ? "DateOfDeath" : "EmploymentEndDate"} as MMDDYYYY (section 18 Q12)`,
  });
  b.push({
    recordType: "Employment",
    operation: "UPDATE",
    targetKey: empKey,
    fields: { terminationDataUpdate: executionDate },
    before: { terminationDataUpdate: emp.terminationDataUpdate },
    sourceFields: [],
    derivationRule: "D-EMP-TERMDATAUPDATE",
    explanation: `Employment.terminationDataUpdate = execution date ${executionDate} (set with every Events load)`,
  });
  if (eventType === "DECFIN") {
    b.push({
      recordType: "Member",
      operation: "UPDATE",
      targetKey: memberKey,
      fields: { dateOfDeath: eventDate },
      before: { dateOfDeath: member.dateOfDeath },
      sourceFields: [dateSource],
      derivationRule: "D-MBR-DOD",
      explanation: `Member.dateOfDeath = ${eventDate}${dateSource === "EmploymentEndDate" ? " (CSV has no DateOfDeath column: EmploymentEndDate used, section 18 Q1)" : ""}`,
    });
  }

  // ---- 8.11 Service-break closure / deletion ----
  const closeDate = addDays(eventDate, 1);
  const breaks = [...emp.serviceBreaks].sort((x, y) => x.startDate.localeCompare(y.startDate) || x.type.localeCompare(y.type) || x.breakId.localeCompare(y.breakId));
  for (const brk of breaks) {
    const key: ArielFieldMap = { employmentId: emp.employmentId, breakId: brk.breakId, type: brk.type, startDate: brk.startDate };
    if (eventType === "TERFIN" && DISABILITY_BREAK_TYPES.has(brk.type)) continue;
    if (brk.startDate > eventDate) {
      b.push({
        recordType: "TransactionsServiceBreak",
        operation: "DELETE",
        targetKey: key,
        fields: {},
        before: { type: brk.type, startDate: brk.startDate, endDate: brk.endDate },
        sourceFields: [dateSource],
        derivationRule: "D-BRK-DELETE",
        explanation: `Break ${brk.type} starts ${brk.startDate}, after the event date ${eventDate}: deleted`,
      });
    } else if (brk.endDate === null || brk.endDate > closeDate) {
      b.push({
        recordType: "TransactionsServiceBreak",
        operation: "CLOSE",
        targetKey: key,
        fields: { endDate: closeDate },
        before: { endDate: brk.endDate },
        sourceFields: [dateSource],
        derivationRule: "D-BRK-CLOSE",
        explanation: `Break ${brk.type} (${brk.startDate} -> ${brk.endDate ?? "open"}) closed at event date + 1 = ${closeDate}`,
      });
    }
  }

  // ---- 8.7 Service, 8.8 Contributions, 8.9 Salary rates, 8.10 PA ----
  const splits: FinalDerivation["contributionSplits"] = {};
  const scopes: Array<[YearScope, ScopeDerived]> = [
    ["CURRENT", d.current],
    ["PREVIOUS", d.previous],
  ];
  const txKey = (type: string, indicator: string, s: ScopeDerived) => ({ type, indicator, summaryAttribute: SUMMARY_FINAL_DATA, beginDate: s.begin, endDate: s.end, paymentDate: s.paymentDate, targetDate: s.targetDate });
  const txFields = (s: ScopeDerived, type: string, indicator: string, amount: DecimalString): ArielFieldMap => ({
    type,
    amount,
    beginDate: s.begin,
    endDate: s.end,
    paymentDate: s.paymentDate,
    targetDate: s.targetDate,
    declarationDate: s.declarationDate,
    transactionIndicator: indicator,
    numberOfPays: s.year,
    summaryAttributes: SUMMARY_FINAL_DATA,
  });
  const txTarget = (type: string, indicator: string, s: ScopeDerived): ArielFieldMap => ({ employmentId: emp.employmentId, type, indicator, summaryAttributes: SUMMARY_FINAL_DATA, beginDate: s.begin, endDate: s.end, paymentDate: s.paymentDate, targetDate: s.targetDate });

  /** UPSERT_ADD onto same-key Ariel rows when present, else CREATE (section 8.7 / 8.8). */
  const pushTx = (recordType: ArielRecordType, existing: Tx[], scope: YearScope, s: ScopeDerived, type: string, indicator: string, fileAmount: DecimalString, sourceFields: AnyCsvColumn[], rule: string, what: string, calculated: ArielFieldMap | null = null) => {
    const matches = existing.filter((t) => sameKey(t, txKey(type, indicator, s)));
    if (matches.length) {
      const existingAmount = money(sum(matches));
      const result = money(new Decimal(existingAmount).plus(fileAmount));
      b.push({
        recordType,
        operation: "UPSERT_ADD",
        yearScope: scope,
        targetKey: txTarget(type, indicator, s),
        fields: txFields(s, type, indicator, result),
        before: { amount: existingAmount, txIds: matches.map((m) => m.txId).sort().join(",") },
        sourceFields,
        derivationRule: rule,
        explanation: `${what} ${scopeSuffix(scope)}: Ariel ${existingAmount} + file ${money(fileAmount)} = ${result} (same key: ${type}/${indicator}/${SUMMARY_FINAL_DATA}/${s.begin}..${s.end})`,
        calculated: { existingAmount, fileAmount: money(fileAmount), resultAmount: result, ...(calculated ?? {}) },
      });
    } else {
      b.push({
        recordType,
        operation: "CREATE",
        yearScope: scope,
        targetKey: txTarget(type, indicator, s),
        fields: txFields(s, type, indicator, money(fileAmount)),
        before: null,
        sourceFields,
        derivationRule: rule,
        explanation: `${what} ${scopeSuffix(scope)}: new transaction ${type}/${indicator} ${money(fileAmount)} for ${s.begin}..${s.end} (payment/target ${s.targetDate})`,
        calculated,
      });
    }
  };

  for (const [scope, s] of scopes) {
    if (s.service) pushTx("TransactionsService", emp.service, scope, s, "CTSRV", "PRV", s.service.amount, [col(scope, "Weeks")], `D-SRV-CTSRV-${scopeSuffix(scope)}`, "CTSRV weeks");
  }
  for (const [scope, s] of scopes) {
    const sfx = scopeSuffix(scope);
    const low = s.contributions.find((c) => c.type === "RPPLOW");
    const high = s.contributions.find((c) => c.type === "RPPHGH");
    if (low) pushTx("TransactionsContributions", emp.contributions, scope, s, "RPPLOW", "PRV", low.amount, [col(scope, "LowContributions")], `D-CONTRIB-RPPLOW-PRV-${sfx}`, "RPPLOW provided");
    if (high) pushTx("TransactionsContributions", emp.contributions, scope, s, "RPPHGH", "PRV", high.amount, [col(scope, "HighContributions")], `D-CONTRIB-RPPHGH-PRV-${sfx}`, "RPPHGH provided");
    if (high) {
      const block = scope === "CURRENT" ? record.currentYear : record.previousYear;
      const split = computeContributionSplit({
        year: s.year,
        arielLowPrv: money(sum(contributionsIn(emp, s.year, "RPPLOW", "PRV"))),
        arielHighPrv: money(sum(contributionsIn(emp, s.year, "RPPHGH", "PRV"))),
        arielLowRetro: money(sum(contributionsIn(emp, s.year, "RPPLOW", "RETRO"))),
        arielHighRetro: money(sum(contributionsIn(emp, s.year, "RPPHGH", "RETRO"))),
        fileLow: low ? low.amount : "0.00",
        fileHigh: high.amount,
        filePa: typeof block.pa === "number" ? block.pa : null,
        arielPa: arielPaFor(member, employerId, s.year),
        priorRpphghClc: money(sum(contributionsIn(emp, s.year, "RPPHGH", "CLC"))),
      });
      if (split) {
        splits[scope] = split;
        if (split.emit) {
          const calc: ArielFieldMap = {
            year: split.year,
            pool: split.pool,
            paEffective: split.paEffective,
            paSource: split.paSource,
            limit: split.limit,
            excess: split.excess,
            priorClc: split.priorClc,
            arielLowPrv: split.terms.arielLowPrv,
            arielHighPrv: split.terms.arielHighPrv,
            arielLowRetro: split.terms.arielLowRetro,
            arielHighRetro: split.terms.arielHighRetro,
            fileLow: split.terms.fileLow,
            fileHigh: split.terms.fileHigh,
          };
          const src: AnyCsvColumn[] = [col(scope, "HighContributions"), col(scope, "LowContributions"), ...(split.paSource === "file" ? [col(scope, "PA")] : [])];
          pushClc(b, emp, s, scope, "RPPHGH", split.rpphghClc, src, `D-CONTRIB-RPPHGH-CLC-${sfx}`, split.explanationRpp, { ...calc, result: split.rpphghClc }, txTarget, txFields, txKey);
          pushClc(b, emp, s, scope, "RCAHGH", split.rcahghClc, src, `D-CONTRIB-RCAHGH-CLC-${sfx}`, split.explanationRca, { ...calc, result: split.rcahghClc }, txTarget, txFields, txKey);
        }
      }
    }
  }
  for (const [scope, s] of scopes) {
    if (!s.salaryRate) continue;
    const rate = money(s.salaryRate.rate);
    b.push({
      recordType: "TransactionsSalaryRates",
      operation: "CREATE",
      yearScope: scope,
      targetKey: { employmentId: emp.employmentId, salaryRateType: "REPORT", effectiveDate: s.salaryRate.effectiveDate, transactionIndicator: "Provided", summaryAttributes: SUMMARY_FINAL_DATA },
      fields: { salaryRateType: "REPORT", rate, effectiveDate: s.salaryRate.effectiveDate, entryDate: executionDate, transactionIndicator: "Provided", numberOfPays: s.year, summaryAttributes: SUMMARY_FINAL_DATA },
      before: null,
      sourceFields: [col(scope, "AnnualizedEarnings")],
      derivationRule: `D-SALRATE-${scopeSuffix(scope)}`,
      explanation: `Salary rate REPORT ${rate} effective ${s.salaryRate.effectiveDate} (MAX(Jan 1 ${s.year}, permanency ${emp.permanencyDate})), entry ${executionDate}`,
    });
  }
  for (const [scope, s] of scopes) {
    if (!s.pa) continue;
    b.push({
      recordType: "PlansTaxInfoPA",
      operation: "CREATE",
      yearScope: scope,
      targetKey: { memberId: member.memberId, employerId, calculationYear: s.pa.calculationYear, inputDate: executionDate },
      fields: { pensionAdjustment: s.pa.amount, calculationYear: s.pa.calculationYear, inputDate: executionDate, employerId },
      before: null,
      sourceFields: [col(scope, "PA")],
      derivationRule: `D-PA-${scopeSuffix(scope)}`,
      explanation: `PA ${s.pa.amount} for calculation year ${s.pa.calculationYear} at employer ${employerId}, input ${executionDate}${s.pa.amount === 0 ? " (0 is recorded as reported)" : ""}`,
    });
  }

  // ---- 8.3 D-NCT, 8.4 calculation request ----
  let membershipStatus: FinalDerivation["membershipStatus"] = null;
  if (d.membershipStatus) {
    const ms = d.membershipStatus;
    membershipStatus = { status: ms.status, subStatus: ms.subStatus, effectiveDate: ms.statusEffectiveDate };
    b.push({
      recordType: "MembershipStatus",
      operation: "CREATE",
      targetKey: { memberId: member.memberId, statusEffectiveDate: ms.statusEffectiveDate },
      fields: { statusCode: "D", statusEffectiveDate: ms.statusEffectiveDate, subStatusCode: "NCT", subStatusEffectiveDate: ms.subStatusEffectiveDate },
      before: null,
      sourceFields: ["EventType", dateSource],
      derivationRule: "D-MSTAT-DNCT",
      explanation: `Last open employment terminated by ${eventType}: membership -> D (Deferred Pensioner) / NCT (Not Completed Termination) effective ${ms.statusEffectiveDate}${ms.statusEffectiveDate !== eventDate ? " (most recent termination date across employments, section 18 Q17)" : ""}`,
      calculated: { previousStatus: member.membership.status ?? null, previousSubStatus: member.membership.subStatus, previousStatusEffectiveDate: member.membership.statusEffectiveDate, statusEventDate: d.statusEventDate },
    });
    const eventCategory = eventType === "TERFIN" ? "Termination" : "Death Before Retirement";
    b.push({
      recordType: "CalculationsBenefit",
      operation: "CREATE",
      targetKey: { memberId: member.memberId, eventCategory, eventDate: d.statusEventDate },
      fields: { eventCategory, eventDate: d.statusEventDate, finalCalculation: false, clientRequestDate: executionDate, estimate: false },
      before: null,
      sourceFields: ["EventType", dateSource],
      derivationRule: "D-CALC-REQUEST",
      explanation: `Preliminary calculation request "${eventCategory}" for ${d.statusEventDate}, client request date ${executionDate} (last open employment terminated)`,
    });
  }

  // ---- 8.6 B139 indicator, 8.5 RETFIN flag ----
  if (eventType === "RETFIN" && input.b139Overridden) {
    b.push({
      recordType: "CalculationIndicator",
      operation: "CREATE",
      targetKey: { memberId: member.memberId, employmentId: emp.employmentId, code: CHG_RET_EED },
      fields: { code: CHG_RET_EED, description: "Change in Employment End Date for Retirement scenario", previousDate: emp.terminationDate, newDate: eventDate },
      before: null,
      sourceFields: ["EmploymentEndDate"],
      derivationRule: "D-CALC-INDICATOR",
      explanation: `B139 overridden: retirement end date changes from ${emp.terminationDate ?? "none"} to ${eventDate}; indicator ${CHG_RET_EED} created (section 18 Q13)`,
    });
  }
  if (eventType === "RETFIN") {
    const st = member.membership.status;
    if (st === "P") {
      b.push({
        recordType: "BenefitReevaluationFlag",
        operation: "SET_FLAG",
        targetKey: memberKey,
        fields: { active: true, reason: "RETFIN financial data loaded" },
        before: null,
        sourceFields: ["EventType"],
        derivationRule: "D-RET-REEVAL-ON",
        explanation: "Member is already a Pensioner (status P): benefit re-evaluation flag activated",
      });
    } else if (st === "D" && member.membership.subStatus === "NCT") {
      notes.push({ rule: INFO_RET_DNCT, message: "Benefit re-evaluation flag not activated: member is D-NCT", params: { status: "D", subStatus: "NCT" } });
    }
  }

  return {
    derived: d,
    items: b.items,
    notes,
    membershipStatus,
    employmentTermination: { terminationDate: eventDate, terminationCode },
    contributionSplits: splits,
  };
}

function pushClc(
  b: ItemBuilder,
  emp: ArielEmployment,
  s: ScopeDerived,
  scope: YearScope,
  type: "RPPHGH" | "RCAHGH",
  amount: DecimalString,
  sourceFields: AnyCsvColumn[],
  rule: string,
  explanation: string,
  calculated: ArielFieldMap,
  txTarget: (type: string, indicator: string, s: ScopeDerived) => ArielFieldMap,
  txFields: (s: ScopeDerived, type: string, indicator: string, amount: DecimalString) => ArielFieldMap,
  txKey: (type: string, indicator: string, s: ScopeDerived) => { type: string; indicator: string; summaryAttribute: string; beginDate: IsoDate; endDate: IsoDate; paymentDate: IsoDate; targetDate: IsoDate },
): void {
  const matches = emp.contributions.filter((t) => sameKey(t, txKey(type, "CLC", s)));
  if (matches.length) {
    const existingAmount = money(sum(matches));
    const result = money(new Decimal(existingAmount).plus(amount));
    b.push({
      recordType: "TransactionsContributions",
      operation: "UPSERT_ADD",
      yearScope: scope,
      targetKey: txTarget(type, "CLC", s),
      fields: txFields(s, type, "CLC", result),
      before: { amount: existingAmount, txIds: matches.map((m) => m.txId).sort().join(",") },
      sourceFields,
      derivationRule: rule,
      explanation: `${explanation}; added to same-key Ariel CLC ${existingAmount} = ${result}`,
      calculated: { ...calculated, existingAmount, resultAmount: result },
    });
  } else {
    b.push({ recordType: "TransactionsContributions", operation: "CREATE", yearScope: scope, targetKey: txTarget(type, "CLC", s), fields: txFields(s, type, "CLC", amount), before: null, sourceFields, derivationRule: rule, explanation, calculated });
  }
}

/** Items of one row in sortOrder, hashed over their pure cores (ArielUpdateProposed.itemsHash). */
export function itemsHash(items: ArielUpdateItemCore[]): string {
  return sha256Hex(canonicalize([...items].sort((a, b) => a.sortOrder - b.sortOrder)));
}

/** Canonical order for a whole update set: (sinPseudo, lineNumber, sortOrder) - architecture section 4.4. */
export function sortItems<T extends Pick<ArielUpdateItemCore, "sinPseudo" | "lineNumber" | "sortOrder">>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sinPseudo.localeCompare(b.sinPseudo) || a.lineNumber - b.lineNumber || a.sortOrder - b.sortOrder);
}

export function contentHashOf(items: ArielUpdateItemCore[]): string {
  return sha256Hex(canonicalize(sortItems(items)));
}

export function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}