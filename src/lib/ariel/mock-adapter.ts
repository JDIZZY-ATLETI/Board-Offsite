import { asc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import type { Db } from "@/lib/db/client";
import {
  mockAddresses,
  mockContributionTx,
  mockEmployers,
  mockEmploymentTypeHistory,
  mockEmployments,
  mockMembers,
  mockMembershipStatusHistory,
  mockPensionAdjustments,
  mockRateTables,
  mockSalaryRates,
  mockServiceBreaks,
  mockServiceTx,
} from "@/lib/db/schema";
import { decryptSin, maskSin, pseudonymizeSin } from "@/lib/pii/sin";
import type { ArielEmployment, ArielMemberSnapshot, ArielRateTables, IsoDate, RateTableName, RateTableRow } from "@/types";
import type { ArielAdapter } from "./adapter";
import { StaticRateTables } from "./rates";
import { InMemoryArielSnapshot, type ArielBatchSnapshot } from "./snapshot";

type MemberRow = typeof mockMembers.$inferSelect;

/**
 * Architecture section 4.6: reads the `ariel_mock` schema. Raw SIN never leaves this module - only the
 * pseudonym and mask are placed on the snapshot; `sin_enc` is never decrypted here.
 */
export class MockArielAdapter implements ArielAdapter {
  readonly name = "MockArielAdapter";
  constructor(
    private readonly db: Db,
    private readonly keys: { pseudonymKey: Buffer; encKey: Buffer },
  ) {}

  async findMembersBySin(sin: string): Promise<ArielMemberSnapshot[]> {
    return this.findMembersBySinPseudo(pseudonymizeSin(this.keys.pseudonymKey, sin));
  }

  async findMembersBySinPseudo(sinPseudo: string): Promise<ArielMemberSnapshot[]> {
    const rows = await this.db.select().from(mockMembers).where(eq(mockMembers.sinPseudo, sinPseudo)).orderBy(asc(mockMembers.memberId));
    return this.assemble(rows);
  }

  async employerExists(employerId: string): Promise<boolean> {
    const [r] = await this.db.select({ id: mockEmployers.employerId }).from(mockEmployers).where(eq(mockEmployers.employerId, employerId));
    return Boolean(r);
  }

  async listEmployers(): Promise<Array<{ employerId: string; name: string }>> {
    const rows = await this.db.select().from(mockEmployers).orderBy(asc(mockEmployers.employerId));
    return rows.map((r) => ({ employerId: r.employerId, name: r.name }));
  }

  async rates(): Promise<ArielRateTables> {
    const rows = await this.db.select().from(mockRateTables);
    return new StaticRateTables(rows.map((r): RateTableRow => ({ table: r.tableName as RateTableName, year: r.year, value: new Decimal(r.value).toString(), placeholder: r.placeholder })));
  }

  async snapshotForBatch(batchId: string, employerId: string, sinPseudos: string[]): Promise<ArielBatchSnapshot> {
    const unique = [...new Set(sinPseudos)].filter(Boolean).sort();
    const members: ArielMemberSnapshot[] = [];
    for (let i = 0; i < unique.length; i += 500) {
      const rows = await this.db.select().from(mockMembers).where(inArray(mockMembers.sinPseudo, unique.slice(i, i + 500)));
      members.push(...(await this.assemble(rows)));
    }
    const rates = await this.rates();
    return new InMemoryArielSnapshot(members, { adapter: this.name, batchId, employerId, requested: unique.length, found: members.length }, rates.rows());
  }

  async listMembers(filter: { employerId?: string; q?: string } = {}): Promise<ArielMemberSnapshot[]> {
    let rows: MemberRow[];
    if (filter.employerId) {
      const ids = await this.db.selectDistinct({ memberId: mockEmployments.memberId }).from(mockEmployments).where(eq(mockEmployments.employerId, filter.employerId));
      if (ids.length === 0) return [];
      rows = await this.db.select().from(mockMembers).where(inArray(mockMembers.memberId, ids.map((r) => r.memberId)));
    } else {
      rows = await this.db.select().from(mockMembers);
    }
    const q = filter.q?.trim();
    if (q) {
      const needle = q.toLowerCase();
      const pseudoHit = /^[0-9a-f]{8,64}$/i.test(q);
      rows = rows.filter((r) => {
        if (pseudoHit && r.sinPseudo.startsWith(needle)) return true;
        if (/^\d{1,3}$/.test(q) && this.maskFor(r).endsWith(q)) return true;
        return `${r.lastName ?? ""} ${r.firstName ?? ""} ${r.scenario ?? ""}`.toLowerCase().includes(needle);
      });
    }
    const members = await this.assemble(rows);
    return members.sort((a, b) => (a.scenario ?? "").localeCompare(b.scenario ?? "", undefined, { numeric: true }) || a.sinPseudo.localeCompare(b.sinPseudo));
  }

  /** Architecture section 13.3: the adapter is one of the three places allowed to decrypt, and only to mask. */
  private maskFor(r: MemberRow): string {
    try {
      return maskSin(decryptSin(this.keys.encKey, r.sinEnc));
    } catch {
      return "***-***-***";
    }
  }

  private async assemble(rows: MemberRow[]): Promise<ArielMemberSnapshot[]> {
    if (rows.length === 0) return [];
    const memberIds = rows.map((r) => r.memberId);
    const [history, addresses, pas, employments] = await Promise.all([
      this.db.select().from(mockMembershipStatusHistory).where(inArray(mockMembershipStatusHistory.memberId, memberIds)),
      this.db.select().from(mockAddresses).where(inArray(mockAddresses.memberId, memberIds)),
      this.db.select().from(mockPensionAdjustments).where(inArray(mockPensionAdjustments.memberId, memberIds)),
      this.db.select().from(mockEmployments).where(inArray(mockEmployments.memberId, memberIds)),
    ]);
    const empIds = employments.map((e) => e.employmentId);
    const [types, breaks, service, contribs, rates] = empIds.length
      ? await Promise.all([
          this.db.select().from(mockEmploymentTypeHistory).where(inArray(mockEmploymentTypeHistory.employmentId, empIds)),
          this.db.select().from(mockServiceBreaks).where(inArray(mockServiceBreaks.employmentId, empIds)),
          this.db.select().from(mockServiceTx).where(inArray(mockServiceTx.employmentId, empIds)),
          this.db.select().from(mockContributionTx).where(inArray(mockContributionTx.employmentId, empIds)),
          this.db.select().from(mockSalaryRates).where(inArray(mockSalaryRates.employmentId, empIds)),
        ])
      : [[], [], [], [], []];
    const d = (s: string | null) => (s ?? null) as IsoDate | null;
    const money = (s: string) => new Decimal(s).toFixed(2);
    return rows.map((r): ArielMemberSnapshot => {
      const emps: ArielEmployment[] = employments
        .filter((e) => e.memberId === r.memberId)
        .map((e) => ({
          employmentId: e.employmentId,
          employerId: e.employerId,
          permanencyDate: e.permanencyDate as IsoDate,
          terminationDate: d(e.terminationDate),
          terminationCode: (e.terminationCode as ArielEmployment["terminationCode"]) ?? null,
          lastAnnualDataUpdate: d(e.lastAnnualDataUpdate),
          otherInformation: e.otherInformation,
          employmentType: e.employmentType as ArielEmployment["employmentType"],
          terminationDataUpdate: d(e.terminationDataUpdate),
          employmentTypeHistory: types.filter((t) => t.employmentId === e.employmentId).map((t) => ({ type: t.type as "FT" | "PT", effectiveDate: t.effectiveDate as IsoDate })),
          serviceBreaks: breaks.filter((b) => b.employmentId === e.employmentId).map((b) => ({ breakId: b.breakId, type: b.type, startDate: b.startDate as IsoDate, endDate: d(b.endDate) })),
          service: service
            .filter((t) => t.employmentId === e.employmentId)
            .map((t) => ({ txId: t.txId, type: t.type as "CTSRV" | "FASRV" | "ACW", amount: new Decimal(t.amount).toFixed(4), beginDate: t.beginDate as IsoDate, endDate: t.endDate as IsoDate, paymentDate: t.paymentDate as IsoDate, targetDate: t.targetDate as IsoDate, declarationDate: d(t.declarationDate), indicator: t.indicator as "PRV" | "CLC" | "REGUL" | "RETRO", summaryAttribute: t.summaryAttribute })),
          contributions: contribs
            .filter((t) => t.employmentId === e.employmentId)
            .map((t) => ({ txId: t.txId, type: t.type as "RPPLOW" | "RPPHGH" | "RCAHGH", amount: money(t.amount), beginDate: t.beginDate as IsoDate, endDate: t.endDate as IsoDate, paymentDate: t.paymentDate as IsoDate, targetDate: t.targetDate as IsoDate, declarationDate: d(t.declarationDate), indicator: t.indicator as "PRV" | "CLC" | "REGUL" | "RETRO", summaryAttribute: t.summaryAttribute })),
          salaryRates: rates
            .filter((t) => t.employmentId === e.employmentId)
            .map((t) => ({ txId: t.txId, type: t.type as "REPORT" | "FARATE", rate: money(t.rate), effectiveDate: t.effectiveDate as IsoDate, entryDate: d(t.entryDate), indicator: t.indicator, summaryAttribute: t.summaryAttribute })),
        }));
      return {
        memberId: r.memberId,
        sinPseudo: r.sinPseudo,
        sinMasked: this.maskFor(r),
        lastName: r.lastName,
        firstName: r.firstName,
        dateOfBirth: r.dateOfBirth as IsoDate,
        dateOfDeath: d(r.dateOfDeath),
        membership: {
          status: r.status,
          subStatus: r.subStatus,
          statusEffectiveDate: d(r.statusEffectiveDate),
          subStatusEffectiveDate: d(r.subStatusEffectiveDate),
          calculationIndicators: r.calculationIndicators ?? [],
          statusHistory: history.filter((h) => h.memberId === r.memberId).map((h) => ({ status: h.status, subStatus: h.subStatus, effectiveDate: h.effectiveDate as IsoDate })),
        },
        employments: emps,
        pensionAdjustments: pas.filter((p) => p.memberId === r.memberId).map((p) => ({ paId: p.paId, employerId: p.employerId, calculationYear: p.calculationYear, amount: p.amount, calculationDate: p.calculationDate as IsoDate, entryDate: p.entryDate as IsoDate })),
        addresses: addresses.filter((a) => a.memberId === r.memberId).map((a) => ({ effectiveStartDate: a.effectiveStartDate as IsoDate })),
        ...(r.scenario ? { scenario: r.scenario } : {}),
      };
    });
  }
}

