import { and, asc, desc, eq } from "drizzle-orm";
import type { AppContext } from "@/lib/app-context";
import { arielUpdateItems, arielUpdateSets, auditLog } from "@/lib/db/schema";
import { memberStream } from "@/lib/ledger/streams";
import { maskSin, normalizeSin, pseudonymizeSin } from "@/lib/pii/sin";
import { getMemberProjection } from "@/lib/projection";
import type { ArielMemberSnapshot, ArielUpdateItem, LedgerEntry, MemberProjection, Session } from "@/types";
import { toItem } from "./update-sets";

export interface MemberLookupResult {
  sinPseudo: string;
  sinMasked: string;
  /** A member projection exists (the member appeared in at least one ledgered batch). */
  found: boolean;
  /** The Ariel reference adapter knows the SIN. */
  inAriel: boolean;
}

/** SIN -> pseudonym (section 11 `POST /api/members/lookup`): the SIN is hashed and never stored or echoed. */
export async function lookupMember(ctx: AppContext, session: Session, rawSin: string, ip: string | null): Promise<MemberLookupResult | null> {
  const sin = normalizeSin(rawSin);
  if (!sin || !/^\d{9}$/.test(sin)) return null;
  const sinPseudo = pseudonymizeSin(ctx.config.sinPseudonymKey, sin);
  const [projection, ariel] = await Promise.all([getMemberProjection(ctx, sinPseudo), ctx.ariel.findMembersBySinPseudo(sinPseudo)]);
  await ctx.db.insert(auditLog).values({
    at: ctx.clock().toISOString(),
    actor: session.actor,
    role: session.role,
    action: "MEMBER_LOOKUP",
    target: `member:${sinPseudo}`,
    ip: ip && /^[0-9a-fA-F.:]+$/.test(ip) ? ip : null,
    details: { found: Boolean(projection), inAriel: ariel.length > 0 },
  });
  return { sinPseudo, sinMasked: maskSin(sin), found: Boolean(projection), inAriel: ariel.length > 0 };
}

export interface MemberView {
  sinPseudo: string;
  projection: MemberProjection | null;
  /** Member stream, oldest first (same as GET /api/ledger/entries?streamId=member:...&order=asc). */
  timeline: LedgerEntry[];
  /** Items of the member's latest update set (pending/approved/exported) for the "Ariel-derived records" tab. */
  items: ArielUpdateItem[];
  ariel: {
    memberId: string;
    sinMasked: string;
    membership: ArielMemberSnapshot["membership"];
    employments: Array<Pick<ArielMemberSnapshot["employments"][number], "employmentId" | "employerId" | "permanencyDate" | "terminationDate" | "terminationCode" | "employmentType" | "otherInformation">>;
  } | null;
}

export async function getMemberView(ctx: AppContext, sinPseudo: string): Promise<MemberView | null> {
  const [projection, arielMembers, timeline] = await Promise.all([getMemberProjection(ctx, sinPseudo), ctx.ariel.findMembersBySinPseudo(sinPseudo), ctx.ledger.list({ streamId: memberStream(sinPseudo), order: "asc", limit: 200 })]);
  const ariel = arielMembers[0] ?? null;
  if (!projection && !ariel && timeline.items.length === 0) return null;
  let items: ArielUpdateItem[] = [];
  const latest = projection?.lastUpdateSet?.updateSetId;
  if (latest) {
    items = (await ctx.db.select().from(arielUpdateItems).where(and(eq(arielUpdateItems.updateSetId, latest), eq(arielUpdateItems.sinPseudo, sinPseudo))).orderBy(asc(arielUpdateItems.lineNumber), asc(arielUpdateItems.sortOrder))).map(toItem);
  } else {
    const [set] = await ctx.db
      .select({ updateSetId: arielUpdateSets.updateSetId })
      .from(arielUpdateItems)
      .innerJoin(arielUpdateSets, eq(arielUpdateSets.updateSetId, arielUpdateItems.updateSetId))
      .where(eq(arielUpdateItems.sinPseudo, sinPseudo))
      .orderBy(desc(arielUpdateSets.builtAt))
      .limit(1);
    if (set) items = (await ctx.db.select().from(arielUpdateItems).where(and(eq(arielUpdateItems.updateSetId, set.updateSetId), eq(arielUpdateItems.sinPseudo, sinPseudo))).orderBy(asc(arielUpdateItems.sortOrder))).map(toItem);
  }
  return {
    sinPseudo,
    projection,
    timeline: timeline.items,
    items,
    ariel: ariel
      ? {
          memberId: ariel.memberId,
          sinMasked: ariel.sinMasked,
          membership: ariel.membership,
          employments: ariel.employments.map((e) => ({ employmentId: e.employmentId, employerId: e.employerId, permanencyDate: e.permanencyDate, terminationDate: e.terminationDate, terminationCode: e.terminationCode, employmentType: e.employmentType, otherInformation: e.otherInformation })),
        }
      : null,
  };
}