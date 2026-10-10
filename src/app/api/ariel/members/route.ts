import { z } from "zod";
import { json, parseQuery, withApi } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({ employerId: z.string().max(16).optional(), q: z.string().max(80).optional() });

/** Mock Ariel browser list (architecture section 11; UX section 5.8). Reviewer/Admin, read-only. */
export const GET = withApi(async (_req, { app, session, url }) => {
  requireRole(session, "Reviewer", "Admin");
  const q = parseQuery(url, query);
  const members = await app.ariel.listMembers({ employerId: q.employerId || undefined, q: q.q || undefined });
  return json({
    adapter: app.ariel.name,
    items: members.map((m) => ({
      sinPseudo: m.sinPseudo,
      sinMasked: m.sinMasked,
      lastName: m.lastName,
      firstName: m.firstName,
      dateOfBirth: m.dateOfBirth,
      dateOfDeath: m.dateOfDeath,
      status: m.membership.status,
      subStatus: m.membership.subStatus,
      scenario: m.scenario ?? null,
      employments: m.employments.map((e) => ({ employerId: e.employerId, terminationCode: e.terminationCode, terminationDate: e.terminationDate, permanencyDate: e.permanencyDate })),
      duplicateSin: members.filter((x) => x.sinPseudo === m.sinPseudo).length > 1,
    })),
  });
});