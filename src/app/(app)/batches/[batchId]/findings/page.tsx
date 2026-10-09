import type { Metadata } from "next";
import { getAppContext } from "@/lib/app-context";
import { canViewPrivateFindings } from "@/lib/auth/roles";
import { findingFacets, listFindings } from "@/lib/queries/findings";
import { recordsByLineNumbers } from "@/lib/queries/records";
import { enumParam, firstParam, intParam, type SearchParamsInput } from "@/lib/ui/search-params";
import { FindingsView } from "@/components/app/findings/findings-table";
import { FINDING_SEVERITIES } from "@/types";
import { loadBatchPage } from "../_lib";

export const metadata: Metadata = { title: "Findings" };
export const dynamic = "force-dynamic";

/** docs/ux-design.md section 5.4.2. Server reads URL filters; PRIVATE findings are filtered server-side by role. */
export default async function FindingsPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<SearchParamsInput> }) {
  const [{ batchId }, sp] = await Promise.all([params, searchParams]);
  const { session, batch } = await loadBatchPage(batchId);
  const ctx = await getAppContext();
  const canSeePrivate = canViewPrivateFindings(session);
  const includePrivate = canSeePrivate && firstParam(sp, "visibility") !== "PUBLIC";
  const severity = enumParam(sp, "severity", FINDING_SEVERITIES);
  const ruleId = firstParam(sp, "ruleId");
  const lineNumber = intParam(sp, "lineNumber");
  const cursor = firstParam(sp, "cursor") ?? null;
  const prev = (firstParam(sp, "prev") ?? "").split("|").filter(Boolean);

  const [page, facets] = await Promise.all([listFindings(ctx, batchId, { severity, ruleId: ruleId || undefined, lineNumber, includePrivate, cursor, limit: 200 }), findingFacets(ctx, batchId, includePrivate)]);
  const records = await recordsByLineNumbers(ctx, batchId, page.items.map((f) => f.lineNumber ?? 0));

  return (
    <FindingsView
      batchId={batchId}
      findings={page.items}
      records={records}
      facets={facets}
      role={session.role}
      nextCursor={page.nextCursor}
      prevCursors={prev}
      rejectedRows={batch.counts.rejected}
      fileRejected={batch.status === "FILE_REJECTED"}
      canSeePrivate={canSeePrivate}
    />
  );
}