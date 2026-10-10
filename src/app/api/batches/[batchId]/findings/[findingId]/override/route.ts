/** Batch-scoped alias of POST /api/findings/{findingId}/override: the batch id must own the finding (404 otherwise). */
export { POST } from "@/app/api/findings/[findingId]/override/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
