import { withApi } from "@/lib/api/handler";
import { handleGetDiff } from "@/lib/api/update-set-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(handleGetDiff);
