import type { FileDerived } from "@/lib/derivation/provisional";
import type { EventsRecord } from "@/types";
import { isZero, zeroOrBlank } from "../../lib/context";
import { yearOf } from "../../lib/dates";
import type { FindingDraft } from "../../types";

/** Shared B181/B182 condition: RETRO contribution paid in the event year, PA reported with zero service/contributions. */
export function retroPaidDraft(record: EventsRecord, d: FileDerived): FindingDraft[] {
  const cy = record.currentYear;
  if (typeof cy.pa !== "number" || cy.pa === 0) return [];
  if (!isZero(cy.weeks) || !isZero(cy.lowContributions) || !zeroOrBlank(cy.highContributions)) return [];
  const retro = d.employment.contributions.find((c) => c.indicator === "RETRO" && yearOf(c.paymentDate) === d.eventYear);
  if (!retro) return [];
  return [{ field: "PA_CurrentYear", yearScope: "CURRENT", params: { 0: d.eventYear }, calculated: { retroPaymentDate: retro.paymentDate, retroAmount: retro.amount, reportedPA: cy.pa } }];
}