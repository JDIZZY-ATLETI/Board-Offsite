import { z } from "zod";
import { sha256Hex } from "@/lib/crypto/hash";
import type { DbOrTx } from "@/lib/db/client";
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
import { encryptSin, luhnValid, pseudonymizeSin } from "@/lib/pii/sin";
import { RATE_TABLE_NAMES, type IsoDate } from "@/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/) as unknown as z.ZodType<IsoDate>;
const money = z.union([z.number(), z.string()]).transform((v) => String(v));

const txBase = {
  beginDate: isoDate,
  endDate: isoDate,
  paymentDate: isoDate,
  targetDate: isoDate,
  declarationDate: isoDate.nullable().optional(),
  indicator: z.enum(["PRV", "CLC", "REGUL", "RETRO"]).default("PRV"),
  summaryAttribute: z.string().default("MDC – Core Data"),
};

export const seedEmploymentSchema = z.object({
  key: z.string().optional(),
  employerId: z.string(),
  permanencyDate: isoDate,
  terminationDate: isoDate.nullable().default(null),
  terminationCode: z.enum(["TER", "DEC", "RET", "AMA"]).nullable().default(null),
  lastAnnualDataUpdate: isoDate.nullable().default(null),
  otherInformation: z.string().nullable().default(null),
  employmentType: z.enum(["FT", "PT"]).default("FT"),
  terminationDataUpdate: isoDate.nullable().default(null),
  typeHistory: z.array(z.object({ type: z.enum(["FT", "PT"]), effectiveDate: isoDate })).default([]),
  serviceBreaks: z.array(z.object({ type: z.string(), startDate: isoDate, endDate: isoDate.nullable().default(null) })).default([]),
  service: z.array(z.object({ type: z.enum(["CTSRV", "FASRV", "ACW"]).default("CTSRV"), amount: money, ...txBase })).default([]),
  contributions: z.array(z.object({ type: z.enum(["RPPLOW", "RPPHGH", "RCAHGH"]), amount: money, ...txBase })).default([]),
  salaryRates: z
    .array(z.object({ type: z.enum(["REPORT", "FARATE"]).default("REPORT"), rate: money, effectiveDate: isoDate, entryDate: isoDate.nullable().default(null), indicator: z.string().default("PRV"), summaryAttribute: z.string().default("MDC – Core Data") }))
    .default([]),
});

export const seedMemberSchema = z.object({
  key: z.string(),
  scenario: z.string().default(""),
  /** 9 digits; must be Luhn-valid (the generator recomputes check digits). */
  sin: z.string().regex(/^\d{9}$/),
  lastName: z.string().nullable().default(null),
  firstName: z.string().nullable().default(null),
  dateOfBirth: isoDate,
  dateOfDeath: isoDate.nullable().default(null),
  status: z.string().nullable().default("A"),
  subStatus: z.string().nullable().default(null),
  statusEffectiveDate: isoDate.nullable().default(null),
  subStatusEffectiveDate: isoDate.nullable().default(null),
  calculationIndicators: z.array(z.string()).default([]),
  statusHistory: z.array(z.object({ status: z.string().nullable(), subStatus: z.string().nullable().default(null), effectiveDate: isoDate })).default([]),
  addresses: z.array(z.object({ effectiveStartDate: isoDate })).default([]),
  pensionAdjustments: z.array(z.object({ employerId: z.string(), calculationYear: z.number().int(), amount: z.number().int(), calculationDate: isoDate, entryDate: isoDate })).default([]),
  employments: z.array(seedEmploymentSchema).default([]),
});

export const arielSeedSchema = z.object({
  $comment: z.string().optional(),
  version: z.literal(1),
  employers: z.array(z.object({ employerId: z.string(), name: z.string(), yearEndClosedIndicator: isoDate.nullable().default(null) })),
  rateTables: z.array(z.object({ table: z.enum(RATE_TABLE_NAMES as [string, ...string[]]), year: z.number().int(), value: money, placeholder: z.boolean().default(true) })),
  members: z.array(seedMemberSchema),
});
export type ArielSeed = z.infer<typeof arielSeedSchema>;
export type SeedMember = z.infer<typeof seedMemberSchema>;
export type SeedEmployment = z.infer<typeof seedEmploymentSchema>;

/** Stable UUID derived from a name so re-seeding yields identical ids (and identical snapshots). */
export function deterministicUuid(name: string): string {
  const h = sha256Hex(`hoopp-ariel-seed:${name}`);
  const hex = h.slice(0, 12) + "7" + h.slice(13, 16) + "8" + h.slice(17, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function parseArielSeed(raw: unknown): ArielSeed {
  const r = arielSeedSchema.safeParse(raw);
  if (!r.success) throw new Error(`invalid ariel seed: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  for (const m of r.data.members) if (!luhnValid(m.sin)) throw new Error(`seed member ${m.key} has a non-Luhn SIN`);
  return r.data;
}

export interface SeedKeys {
  pseudonymKey: Buffer;
  encKey: Buffer;
}

export interface SeedResult {
  members: number;
  employments: number;
  employers: number;
  rateRows: number;
}

/** Idempotent: truncates every ariel_mock table, then reloads the seed. Deterministic ids. */
export async function seedArielMock(db: DbOrTx, seed: ArielSeed, keys: SeedKeys): Promise<SeedResult> {
  await db.delete(mockSalaryRates);
  await db.delete(mockContributionTx);
  await db.delete(mockServiceTx);
  await db.delete(mockServiceBreaks);
  await db.delete(mockEmploymentTypeHistory);
  await db.delete(mockEmployments);
  await db.delete(mockPensionAdjustments);
  await db.delete(mockAddresses);
  await db.delete(mockMembershipStatusHistory);
  await db.delete(mockMembers);
  await db.delete(mockEmployers);
  await db.delete(mockRateTables);

  if (seed.employers.length) await db.insert(mockEmployers).values(seed.employers.map((e) => ({ employerId: e.employerId, name: e.name, yearEndClosedIndicator: e.yearEndClosedIndicator })));
  if (seed.rateTables.length) await db.insert(mockRateTables).values(seed.rateTables.map((r) => ({ tableName: r.table, year: r.year, value: r.value, placeholder: r.placeholder })));

  let employments = 0;
  for (const m of seed.members) {
    const memberId = deterministicUuid(`member:${m.key}`);
    await db.insert(mockMembers).values({
      memberId,
      sinEnc: encryptSin(keys.encKey, m.sin),
      sinPseudo: pseudonymizeSin(keys.pseudonymKey, m.sin),
      lastName: m.lastName,
      firstName: m.firstName,
      dateOfBirth: m.dateOfBirth,
      dateOfDeath: m.dateOfDeath,
      status: m.status,
      subStatus: m.subStatus,
      statusEffectiveDate: m.statusEffectiveDate,
      subStatusEffectiveDate: m.subStatusEffectiveDate,
      calculationIndicators: m.calculationIndicators,
      scenario: m.scenario || null,
    });
    if (m.statusHistory.length) await db.insert(mockMembershipStatusHistory).values(m.statusHistory.map((s) => ({ memberId, status: s.status, subStatus: s.subStatus, effectiveDate: s.effectiveDate })));
    if (m.addresses.length) await db.insert(mockAddresses).values(m.addresses.map((a) => ({ memberId, effectiveStartDate: a.effectiveStartDate })));
    if (m.pensionAdjustments.length) {
      await db.insert(mockPensionAdjustments).values(
        m.pensionAdjustments.map((p, i) => ({ paId: deterministicUuid(`pa:${m.key}:${i}`), memberId, employerId: p.employerId, calculationYear: p.calculationYear, amount: p.amount, calculationDate: p.calculationDate, entryDate: p.entryDate })),
      );
    }
    for (const [ei, e] of m.employments.entries()) {
      const ek = e.key ?? `${ei}`;
      const employmentId = deterministicUuid(`employment:${m.key}:${ek}`);
      employments += 1;
      await db.insert(mockEmployments).values({
        employmentId,
        memberId,
        employerId: e.employerId,
        permanencyDate: e.permanencyDate,
        terminationDate: e.terminationDate,
        terminationCode: e.terminationCode,
        lastAnnualDataUpdate: e.lastAnnualDataUpdate,
        otherInformation: e.otherInformation,
        employmentType: e.employmentType,
        terminationDataUpdate: e.terminationDataUpdate,
      });
      const history = e.typeHistory.length ? e.typeHistory : [{ type: e.employmentType, effectiveDate: e.permanencyDate }];
      await db.insert(mockEmploymentTypeHistory).values(history.map((h) => ({ employmentId, type: h.type, effectiveDate: h.effectiveDate })));
      if (e.serviceBreaks.length) {
        await db.insert(mockServiceBreaks).values(e.serviceBreaks.map((b, i) => ({ breakId: deterministicUuid(`break:${m.key}:${ek}:${i}`), employmentId, type: b.type, startDate: b.startDate, endDate: b.endDate })));
      }
      if (e.service.length) {
        await db.insert(mockServiceTx).values(
          e.service.map((t, i) => ({ txId: deterministicUuid(`svc:${m.key}:${ek}:${i}`), employmentId, type: t.type, amount: t.amount, beginDate: t.beginDate, endDate: t.endDate, paymentDate: t.paymentDate, targetDate: t.targetDate, declarationDate: t.declarationDate ?? null, indicator: t.indicator, summaryAttribute: t.summaryAttribute })),
        );
      }
      if (e.contributions.length) {
        await db.insert(mockContributionTx).values(
          e.contributions.map((t, i) => ({ txId: deterministicUuid(`ctb:${m.key}:${ek}:${i}`), employmentId, type: t.type, amount: t.amount, beginDate: t.beginDate, endDate: t.endDate, paymentDate: t.paymentDate, targetDate: t.targetDate, declarationDate: t.declarationDate ?? null, indicator: t.indicator, summaryAttribute: t.summaryAttribute })),
        );
      }
      if (e.salaryRates.length) {
        await db.insert(mockSalaryRates).values(
          e.salaryRates.map((t, i) => ({ txId: deterministicUuid(`sal:${m.key}:${ek}:${i}`), employmentId, type: t.type, rate: t.rate, effectiveDate: t.effectiveDate, entryDate: t.entryDate, indicator: t.indicator, summaryAttribute: t.summaryAttribute })),
        );
      }
    }
  }
  return { members: seed.members.length, employments, employers: seed.employers.length, rateRows: seed.rateTables.length };
}