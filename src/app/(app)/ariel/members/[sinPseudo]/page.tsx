import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAppContext } from "@/lib/app-context";
import { requirePageRole } from "@/lib/auth/page-session";
import { displayName, formatDecimal, formatInt } from "@/lib/ui/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/app/alert";
import { HashChip } from "@/components/app/ledger/hash-chip";
import { MaskedSIN } from "@/components/app/masked-sin";
import { PageHeader } from "@/components/app/page-header";
import type { ArielEmployment, ArielMemberSnapshot } from "@/types";

export const metadata: Metadata = { title: "Mock Ariel member" };
export const dynamic = "force-dynamic";

const PSEUDO = /^[0-9a-f]{64}$/;

/** docs/ux-design.md section 5.8 member snapshot page: employments, service, contributions, salary rates, PA, status, breaks. */
export default async function ArielMemberPage({ params }: { params: Promise<{ sinPseudo: string }> }) {
  const { sinPseudo } = await params;
  await requirePageRole("Reviewer", "Admin");
  if (!PSEUDO.test(sinPseudo)) notFound();
  const ctx = await getAppContext();
  const members = await ctx.ariel.findMembersBySinPseudo(sinPseudo);
  if (members.length === 0) notFound();
  const primary = members[0];
  return (
    <div className="space-y-4" data-testid="ariel-member-page">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <MaskedSIN masked={primary.sinMasked} />
            <span>{displayName(primary.firstName, primary.lastName) || "Unnamed member"}</span>
          </span>
        }
        srTitle={`Mock Ariel member ${primary.sinMasked}`}
        breadcrumbs={[{ label: "Audit" }, { label: "Mock Ariel", href: "/ariel" }, { label: primary.sinMasked }]}
        meta={[
          { label: "Pseudonym", value: <HashChip hash={sinPseudo} truncate={12} /> },
          { label: "Date of birth", value: primary.dateOfBirth },
          ...(primary.dateOfDeath ? [{ label: "Date of death", value: primary.dateOfDeath }] : []),
          { label: "Status", value: <span className="font-mono">{primary.membership.status ?? "—"}{primary.membership.subStatus ? ` / ${primary.membership.subStatus}` : ""}</span> },
          ...(primary.scenario ? [{ label: "Scenario", value: primary.scenario }] : []),
        ]}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/ariel">
              <ArrowLeft aria-hidden="true" /> All members
            </Link>
          </Button>
        }
      />
      <Alert variant="info" title={`Mock data — adapter: ${ctx.ariel.name}`}>
        Snapshot of the member as the rules see it. Batches freeze their own copy at validation time (silver/ariel-snapshot.ndjson).
      </Alert>
      {members.length > 1 ? (
        <Alert variant="warning" title={`${members.length} member rows share this SIN`}>
          B204 rejects Events rows for this SIN until Ariel is corrected. Each row is shown below.
        </Alert>
      ) : null}
      {members.map((m, i) => (
        <MemberSections key={m.memberId} member={m} index={members.length > 1 ? i + 1 : null} />
      ))}
    </div>
  );
}

function MemberSections({ member: m, index }: { member: ArielMemberSnapshot; index: number | null }) {
  const title = index ? `Member row ${index} · ${displayName(m.firstName, m.lastName)}` : null;
  return (
    <div className="space-y-4">
      {title ? <h2 className="text-h2">{title}</h2> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Membership status</CardTitle>
            <CardDescription>
              Calculation indicators: {m.membership.calculationIndicators.length ? m.membership.calculationIndicators.join(", ") : "none"}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <SimpleTable caption="Membership status history" headers={["Effective", "Status", "Sub-status"]} rows={m.membership.statusHistory.map((s) => [s.effectiveDate, s.status ?? "—", s.subStatus ?? "—"])} empty="No status history." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pension adjustments (PA)</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <SimpleTable caption="Pension adjustments" headers={["Year", "Employer", "Amount", "Calculated", "Entered"]} rows={m.pensionAdjustments.map((p) => [String(p.calculationYear), p.employerId, formatInt(p.amount), p.calculationDate, p.entryDate])} empty="No PA records." numeric={[2]} />
          </CardContent>
        </Card>
      </div>
      <section aria-label="Employments" className="space-y-4">
        <h2 className="text-h2">
          Employments <span className="text-small font-normal text-ink-muted">({formatInt(m.employments.length)})</span>
        </h2>
        {m.employments.length === 0 ? <p className="text-small text-ink-muted">No employments.</p> : m.employments.map((e) => <EmploymentCard key={e.employmentId} e={e} />)}
      </section>
      {m.addresses.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Addresses</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <SimpleTable caption="Address effective dates" headers={["Effective start"]} rows={m.addresses.map((a) => [a.effectiveStartDate])} empty="None." />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function EmploymentCard({ e }: { e: ArielEmployment }) {
  const open = !e.terminationDate;
  return (
    <Card data-testid={`ariel-employment-${e.employerId}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{e.employerId}</span>
          <span className={open ? "rounded-sm bg-ok-soft px-1.5 py-0.5 text-caption font-medium text-ok-text" : "rounded-sm bg-surface px-1.5 py-0.5 text-caption font-medium text-ink-muted"}>{open ? "active" : `terminated ${e.terminationDate} · ${e.terminationCode ?? "—"}`}</span>
          <span className="text-caption font-normal text-ink-muted">{e.employmentType}</span>
        </CardTitle>
        <CardDescription>
          Permanency {e.permanencyDate}
          {e.lastAnnualDataUpdate ? ` · last annual data ${e.lastAnnualDataUpdate}` : ""}
          {e.terminationDataUpdate ? ` · termination data ${e.terminationDataUpdate}` : ""}
          {e.otherInformation ? ` · other information "${e.otherInformation}"` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-0 xl:grid-cols-2">
        <SimpleTable caption="Employment type history" title="Type history" headers={["Effective", "Type"]} rows={e.employmentTypeHistory.map((h) => [h.effectiveDate, h.type])} empty="None." />
        <SimpleTable caption="Service breaks" title="Service breaks" headers={["Type", "Start", "End"]} rows={e.serviceBreaks.map((b) => [b.type, b.startDate, b.endDate ?? "open"])} empty="None." />
        <SimpleTable caption="Service transactions" title="Service" headers={["Type", "Amount", "Begin", "End", "Target", "Indicator", "Summary attribute"]} rows={e.service.map((t) => [t.type, formatDecimal(t.amount, 2), t.beginDate, t.endDate, t.targetDate, t.indicator, t.summaryAttribute])} empty="None." numeric={[1]} />
        <SimpleTable caption="Contribution transactions" title="Contributions" headers={["Type", "Amount", "Begin", "End", "Payment", "Indicator", "Summary attribute"]} rows={e.contributions.map((t) => [t.type, formatDecimal(t.amount, 2), t.beginDate, t.endDate, t.paymentDate, t.indicator, t.summaryAttribute])} empty="None." numeric={[1]} />
        <SimpleTable caption="Salary rates" title="Salary rates" headers={["Type", "Rate", "Effective", "Entered", "Indicator", "Summary attribute"]} rows={e.salaryRates.map((s) => [s.type, formatDecimal(s.rate, 2), s.effectiveDate, s.entryDate ?? "—", s.indicator, s.summaryAttribute])} empty="None." numeric={[1]} />
      </CardContent>
    </Card>
  );
}

function SimpleTable({ caption, title, headers, rows, empty, numeric = [] }: { caption: string; title?: string; headers: string[]; rows: string[][]; empty: string; numeric?: number[] }) {
  return (
    <section aria-label={caption} className="min-w-0">
      {title ? (
        <h3 className="px-5 pb-1 text-h3">
          {title} <span className="text-small font-normal text-ink-muted">({formatInt(rows.length)})</span>
        </h3>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-5 text-small text-ink-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-border text-left text-caption text-ink-muted">
                {headers.map((h, i) => (
                  <th key={h} scope="col" className={`px-3 py-1.5 font-medium first:pl-5 last:pr-5 ${numeric.includes(i) ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/60 last:border-0">
                  {r.map((c, ci) => (
                    <td key={ci} className={`px-3 py-1 first:pl-5 last:pr-5 ${numeric.includes(ci) ? "text-right tabular-nums" : ci === 0 ? "font-mono text-caption" : "tabular-nums"}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}