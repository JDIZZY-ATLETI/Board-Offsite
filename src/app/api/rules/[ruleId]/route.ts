import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { json, parseJsonBody, withApi } from "@/lib/api/handler";
import { requireRole } from "@/lib/auth/session";
import { patchRuleConfig, resetRuleConfig, RulesConfigError } from "@/lib/rules/config-store";
import { rulesCatalogue } from "@/lib/queries/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchBody = z.object({
  enabled: z.boolean().optional(),
  tolerances: z.record(z.string(), z.union([z.number(), z.string().max(32)])).optional(),
  reason: z.string().min(3).max(500),
});

function translate(err: unknown): never {
  if (err instanceof RulesConfigError) throw new ApiError(err.status, err.code, err.message);
  throw err;
}

/** GET /api/rules/{ruleId}: one catalogue item (override reasons for the OverrideDrawer); role "any" like GET /api/rules. */
export const GET = withApi(async (_req, { app, params }) => {
  const ruleId = z.string().min(1).max(64).parse(params.ruleId);
  const catalogue = await rulesCatalogue(app);
  const rule = catalogue.items.find((r) => r.id === ruleId);
  if (!rule) throw new ApiError(404, "NOT_FOUND", `rule ${ruleId} not found`);
  return json({ rule, configHash: catalogue.config.hash });
});

/** PATCH /api/rules/{ruleId} (Admin): enable/disable + tolerance edits, ledgered on the system stream. */
export const PATCH = withApi(async (req, { app, session, params }) => {
  const s = requireRole(session, "Admin");
  const ruleId = z.string().min(1).max(64).parse(params.ruleId);
  const body = await parseJsonBody(req, patchBody);
  if (body.enabled === undefined && !body.tolerances) throw new ApiError(400, "VALIDATION_ERROR", "nothing to change");
  const result = await patchRuleConfig(app, s, ruleId, body).catch(translate);
  const catalogue = await rulesCatalogue(app);
  return json({ rule: catalogue.items.find((r) => r.id === ruleId), config: catalogue.config, changes: result.changes, ledgerSeq: result.ledgerSeq });
});

/** DELETE /api/rules/{ruleId} (Admin): drop every override for the rule. */
export const DELETE = withApi(async (req, { app, session, params }) => {
  const s = requireRole(session, "Admin");
  const ruleId = z.string().min(1).max(64).parse(params.ruleId);
  const reason = new URL(req.url).searchParams.get("reason") ?? "reset to defaults";
  const result = await resetRuleConfig(app, s, ruleId, reason).catch(translate);
  const catalogue = await rulesCatalogue(app);
  return json({ rule: catalogue.items.find((r) => r.id === ruleId), config: catalogue.config, ledgerSeq: result.ledgerSeq });
});