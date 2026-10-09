import { json, withApi } from "@/lib/api/handler";
import { EVENTS_RULES } from "@/lib/rules/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rule catalogue (architecture section 11). Phase 2 adds config toggles. */
export const GET = withApi(async (_req, { app }) =>
  json({
    items: EVENTS_RULES.map((r) => ({
      id: r.id,
      label: r.label,
      messageId: typeof r.messageId === "function" ? "multiple" : r.messageId,
      level: r.level,
      severity: r.severity,
      visibility: r.visibility,
      tool: r.tool,
      overrideReasons: r.overrideReasons,
      requiresAriel: r.requiresAriel,
      implemented: !r.requiresAriel,
      enabled: r.enabledByDefault && !app.config.rulesDisabled.has(r.id),
      dataImportMessage: r.dataImportMessage,
      portalMessage: r.portalMessage,
    })),
  }),
);
