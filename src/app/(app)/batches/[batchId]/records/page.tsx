import type { Metadata } from "next";
import { getAppContext } from "@/lib/app-context";
import { listRecords, recordOutcomeCounts } from "@/lib/queries/records";
import { enumParam, firstParam, type SearchParamsInput } from "@/lib/ui/search-params";
import { RecordsTable } from "@/components/app/records/records-table";
import { loadBatchPage } from "../_lib";

export const metadata: Metadata = { title: "Records" };
export const dynamic = "force-dynamic";

/** docs/ux-design.md section 5.4.3. */
export default async function RecordsPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<SearchParamsInput> }) {
  const [{ batchId }, sp] = await Promise.all([params, searchParams]);
  const { batch } = await loadBatchPage(batchId);
  const ctx = await getAppContext();
  const accepted = enumParam(sp, "accepted", ["true", "false", "held"] as const);
  const cursor = firstParam(sp, "cursor") ?? null;
  const prev = (firstParam(sp, "prev") ?? "").split("|").filter(Boolean);
  const [page, counts] = await Promise.all([listRecords(ctx, batchId, { accepted, cursor, limit: 100 }), recordOutcomeCounts(ctx, batchId)]);
  return <RecordsTable batchId={batchId} records={page.items} nextCursor={page.nextCursor} prevCursors={prev} fileRejected={batch.status === "FILE_REJECTED"} counts={counts} />;
}