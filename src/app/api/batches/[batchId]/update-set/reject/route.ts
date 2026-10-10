import { withApi } from "@/lib/api/handler";
import { handleReject } from "@/lib/api/update-set-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(handleReject);
