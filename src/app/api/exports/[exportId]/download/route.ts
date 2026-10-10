import { z } from "zod";
import { notFound } from "@/lib/api/errors";
import { parseQuery, withApi } from "@/lib/api/handler";
import { clientIp } from "@/lib/api/update-set-handlers";
import { requireRole } from "@/lib/auth/session";
import { readExportFile } from "@/lib/pipeline/approval";
import { getExport } from "@/lib/queries/update-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({ file: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).default("ariel-update-set.json") });

/** Admin only, audit-logged: export files are the only artifacts carrying raw SINs (architecture section 13.3). */
export const GET = withApi(async (req, { app, session, params, url }) => {
  const s = requireRole(session, "Admin");
  const exp = await getExport(app, z.string().uuid().parse(params.exportId));
  if (!exp) throw notFound("export");
  const { file } = parseQuery(url, query);
  const r = await readExportFile(app, s, exp, file, { ip: clientIp(req) });
  return new Response(new Uint8Array(r.bytes), {
    status: 200,
    headers: { "content-type": r.file.contentType, "content-length": String(r.bytes.length), "cache-control": "no-store", "content-disposition": `attachment; filename="${exp.exportId}-${r.file.name}"`, "x-content-sha256": r.file.sha256 },
  });
});
