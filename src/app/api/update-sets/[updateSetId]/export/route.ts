import { withApi } from "@/lib/api/handler";
import { handleExport } from "@/lib/api/update-set-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(handleExport);
