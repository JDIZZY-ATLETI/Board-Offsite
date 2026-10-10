import { derivedTransactions } from "@/lib/derivation/provisional";
import { l2Rule } from "./_shared";

const NHH_INDICATORS = ["NHHSIS", "NHHSTJ", "NHHPRO", "NHHSTM", "NHHGR"];

/** B223_NHH_MEMBER / 2953: NHH merger guard; employer codes and merger dates are config-driven (section 18 Q23). */
export const B223 = l2Rule({
  id: "B223",
  label: "B223_NHH_MEMBER",
  messageId: "2953",
  severity: "COMPLETE_MEMBER_ERROR",
  visibility: "PUBLIC",
  specNote: "Q23: NHH employer codes and merger dates come from config/rules.events.json.",
  dataImportMessage: "This event cannot be submitted via HOOPP Insight. Please contact HOOPP for assistance.",
  portalMessage: "This event cannot be submitted via HOOPP Insight. Please contact HOOPP for assistance.",
  appliesTo: (_r, _d, ctx) => ctx.config.nhhEmployers.includes(ctx.batch.employerId),
  evaluate(_record, d, ctx) {
    const indicators = d.member.membership.calculationIndicators.filter((i) => NHH_INDICATORS.includes(i));
    if (indicators.length === 0) return [];
    for (const ind of indicators) {
      const merger = ctx.config.nhh[ind];
      if (!merger) continue;
      const hit = derivedTransactions(d).find((t) => t.targetDate < merger);
      if (hit) return [{ params: {}, calculated: { indicator: ind, mergerEffectiveDate: merger, targetDate: hit.targetDate, transaction: hit.type } }];
    }
    return [];
  },
});