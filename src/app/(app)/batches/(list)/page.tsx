import type { Metadata } from "next";
import Link from "next/link";
import { Upload } from "lucide-react";
import { getAppContext } from "@/lib/app-context";
import { requirePageSession } from "@/lib/auth/page-session";
import { employerScope } from "@/lib/auth/roles";
import { listBatches } from "@/lib/queries/batches";
import { enumParam, firstParam, type SearchParamsInput } from "@/lib/ui/search-params";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { BatchesTableLive } from "./batches-table-live";
import { BATCH_STATUSES } from "@/types";

export const metadata: Metadata = { title: "Batches" };
export const dynamic = "force-dynamic";

/** docs/ux-design.md section 5.3. Filters live in the URL; a client island polls while anything is transient. */
export default async function BatchesPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const sp = await searchParams;
  const session = await requirePageSession();
  const ctx = await getAppContext();
  const status = enumParam(sp, "status", BATCH_STATUSES);
  const employerId = firstParam(sp, "employerId");
  const cursor = firstParam(sp, "cursor") ?? null;
  const prev = (firstParam(sp, "prev") ?? "").split("|").filter(Boolean);
  const page = await listBatches(ctx, { status, employerId, scopeEmployerId: employerScope(session), cursor, limit: 50 });
  const canUpload = session.role !== "Reviewer";
  const view = status === "PENDING_APPROVAL" ? "Pending approvals" : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title={view ?? "Batches"}
        description={view ? "Update Sets waiting for a Reviewer decision." : "Every Events file received, newest first."}
        breadcrumbs={view ? [{ label: "Review" }, { label: view }] : [{ label: "Submit" }, { label: "Batches" }]}
        actions={
          canUpload ? (
            <Button asChild>
              <Link href="/upload">
                <Upload aria-hidden="true" /> Upload Events file
              </Link>
            </Button>
          ) : null
        }
      />
      <BatchesTableLive batches={page.items} nextCursor={page.nextCursor} prevCursors={prev} role={session.role} showEmployer={session.role !== "EmployerSubmitter"} />
    </div>
  );
}