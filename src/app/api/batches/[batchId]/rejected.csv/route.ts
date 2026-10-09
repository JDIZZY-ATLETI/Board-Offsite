import { GET as reportGet } from "../reports/[name]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Convenience alias for GET /api/batches/{id}/reports/rejected.csv (architecture section 11). */
export async function GET(req: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const p = await ctx.params;
  return reportGet(req, { params: Promise.resolve({ ...p, name: "rejected.csv" }) });
}
