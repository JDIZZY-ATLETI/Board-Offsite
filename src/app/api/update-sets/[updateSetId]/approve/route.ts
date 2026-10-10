import { withApi } from "@/lib/api/handler";
import { handleApprove } from "@/lib/api/update-set-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(handleApprove);
