import type { Metadata } from "next";
import { getAppContext } from "@/lib/app-context";
import { appEnv, requirePageRole } from "@/lib/auth/page-session";
import { firstParam, type SearchParamsInput } from "@/lib/ui/search-params";
import { formatInt } from "@/lib/ui/format";
import { Alert } from "@/components/app/alert";
import { ArielMembersTable, type ArielMemberListItem } from "@/components/app/ariel/ariel-members-table";
import { RatesPanel } from "@/components/app/ariel/rates-panel";
import { ReseedButton } from "@/components/app/ariel/reseed-button";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Mock Ariel" };
export const dynamic = "force-dynamic";

/** docs/ux-design.md section 5.8: read-only reference browser over the mock Ariel snapshot (Reviewer/Admin). */
export default async function ArielBrowserPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const sp = await searchParams;
  const session = await requirePageRole("Reviewer", "Admin");
  const ctx = await getAppContext();
  const employerId = firstParam(sp, "employerId");
  const q = firstParam(sp, "q");
  const [members, employers, rates] = await Promise.all([ctx.ariel.listMembers({ employerId: employerId || undefined, q: q || undefined }), ctx.ariel.listEmployers(), ctx.ariel.rates()]);
  const dev = appEnv() !== "prod";
  const items: ArielMemberListItem[] = members.map((m) => ({
    sinPseudo: m.sinPseudo,
    sinMasked: m.sinMasked,
    lastName: m.lastName,
    firstName: m.firstName,
    dateOfBirth: m.dateOfBirth,
    dateOfDeath: m.dateOfDeath,
    status: m.membership.status,
    subStatus: m.membership.subStatus,
    scenario: dev ? (m.scenario ?? null) : null,
    employments: m.employments.map((e) => ({ employerId: e.employerId, terminationCode: e.terminationCode, terminationDate: e.terminationDate, permanencyDate: e.permanencyDate })),
    duplicateSin: members.filter((x) => x.sinPseudo === m.sinPseudo).length > 1,
  }));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Mock Ariel"
        description="Read-only reference data the rules are checked against. SINs are masked; names and dates come from the seed."
        breadcrumbs={[{ label: "Audit" }, { label: "Mock Ariel" }]}
        meta={[
          { label: "Adapter", value: <span className="font-mono">{ctx.ariel.name}</span> },
          { label: "Members", value: formatInt(items.length) },
          { label: "Employers", value: employers.map((e) => e.employerId).join(", ") },
        ]}
        actions={session.role === "Admin" && dev ? <ReseedButton /> : null}
      />
      <Alert variant="info" title={`Mock data — adapter: ${ctx.ariel.name}`}>
        Reviewers use this browser to sanity-check findings against the snapshot (architecture section 4.6). Rate tables are placeholders until HOOPP confirms them (section 18 Q9).
      </Alert>
      <ArielMembersTable items={items} employers={employers} showScenario={dev} />
      <RatesPanel rows={rates.rows()} adapter={ctx.ariel.name} />
    </div>
  );
}