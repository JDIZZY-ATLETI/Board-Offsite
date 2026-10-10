import type { Metadata } from "next";
import Link from "next/link";
import { getAppContext } from "@/lib/app-context";
import { requirePageRole } from "@/lib/auth/page-session";
import { SYSTEM_STREAM } from "@/lib/ledger/streams";
import { rulesCatalogue } from "@/lib/queries/rules";
import { listOverrides } from "@/lib/rules/config-store";
import { formatDateTime, formatInt } from "@/lib/ui/format";
import { enumParam, type SearchParamsInput } from "@/lib/ui/search-params";
import { Alert } from "@/components/app/alert";
import { HashChip } from "@/components/app/ledger/hash-chip";
import { PageHeader } from "@/components/app/page-header";
import { RulesHistory } from "@/components/app/rules/rules-history";
import { RulesTable } from "@/components/app/rules/rules-table";
import type { RulesConfigChangedPayload } from "@/types";

export const metadata: Metadata = { title: "Rules & configuration" };
export const dynamic = "force-dynamic";

/** docs/ux-design.md section 5.9: registry (Reviewer read-only, Admin edits), tolerances, change history from the system stream. */
export default async function AdminRulesPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const sp = await searchParams;
  const session = await requirePageRole("Reviewer", "Admin");
  const ctx = await getAppContext();
  const tab = enumParam(sp, "tab", ["registry", "history"] as const) ?? "registry";
  const [catalogue, overrides, history] = await Promise.all([rulesCatalogue(ctx), listOverrides(ctx.db), ctx.ledger.list({ streamId: SYSTEM_STREAM, eventType: "RulesConfigChanged", limit: 100, order: "desc" })]);
  const canEdit = session.role === "Admin";
  const overriddenKeys: Record<string, string[]> = {};
  for (const o of overrides) {
    if (o.key === "enabled") continue;
    (overriddenKeys[o.ruleId] ??= []).push(o.key);
  }
  const last = history.items[0];
  const lastPayload = last ? (last.payload as unknown as RulesConfigChangedPayload) : null;
  const enabledCount = catalogue.items.filter((r) => r.enabled).length;
  const tabs = [
    { label: `Rule registry (${formatInt(catalogue.items.length)})`, href: "/admin/rules", active: tab === "registry" },
    { label: `Change history (${formatInt(history.items.length)})`, href: "/admin/rules?tab=history", active: tab === "history" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rules & configuration"
        description={canEdit ? "Enable or disable rules and edit tolerances. Every change needs a reason and is written to the ledger." : "Read-only view of the effective rule configuration. An Admin records changes."}
        breadcrumbs={[{ label: "Admin" }, { label: "Rules & config" }]}
        meta={[
          { label: "Config hash", value: <span data-testid="rules-config-hash"><HashChip hash={catalogue.config.hash} truncate={12} /></span> },
          { label: "Enabled", value: `${formatInt(enabledCount)} of ${formatInt(catalogue.items.length)}` },
          { label: "Admin overrides", value: formatInt(overrides.length) },
          ...(last && lastPayload
            ? [{ label: "Last change", value: <span>{formatDateTime(last.occurredAt)} by {last.actor.replace(/^user:/, "")} · <Link href={`/ledger?seq=${last.seq}`} className="font-mono text-brand underline-offset-2 hover:underline">ledger #{formatInt(last.seq)}</Link></span> }]
            : []),
          ...(catalogue.config.disabled.length ? [{ label: "Disabled by env", value: <span className="font-mono">{catalogue.config.disabled.join(", ")}</span> }] : []),
        ]}
        tabs={tabs}
        tabsLabel="Rules sections"
      />
      <Alert variant="info" title="Changes apply to new batches only">
        Each batch is validated with the configuration in force when it is received and keeps that hash (`rulesConfigHash`, silver/rules-config.json). Earlier batches are never re-evaluated by a config change.
      </Alert>
      {tab === "history" ? <RulesHistory entries={history.items} /> : <RulesTable items={catalogue.items} canEdit={canEdit} overriddenKeys={overriddenKeys} />}
    </div>
  );
}