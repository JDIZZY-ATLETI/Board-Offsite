import * as React from "react";
import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEVERITY_MAP, TOKEN_CLASSES } from "@/lib/ui/status-map";
import { formatDecimal, initials as initialsOf } from "@/lib/ui/format";
import { MaskedSIN } from "@/components/app/masked-sin";
import type { ValidationFinding } from "@/types";
import { hintFor } from "./finding-hints";

export interface FindingRecordSummary {
  lineNumber: number;
  sinMasked: string | null;
  sinPseudo?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  eventType?: string | null;
  eventDate?: string | null;
}

export interface FindingCardProps {
  finding: ValidationFinding;
  record?: FindingRecordSummary | null;
  compact?: boolean;
  /** Hide the Row / member line (when grouped by row the header already shows it). */
  hideRow?: boolean;
  className?: string;
}

const VALUE_LABELS: Record<string, string> = {
  fileValue: "File value",
  max: "HOOPP calculated maximum",
  min: "HOOPP expected minimum",
  ariel: "Already in pension records",
  occurrences: "Rows with this SIN",
  eventDate: "Event date",
  executionDate: "Execution date",
  invalidLabels: "Unknown columns",
  duplicateLabels: "Duplicate columns",
  reason: "Reason",
};

function valueEntries(f: ValidationFinding): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  const raw = f.params?.["1"] ?? f.params?.["0"];
  if (raw !== undefined && f.calculated?.masked !== true && f.ruleId !== "I1") out.push({ label: "File value", value: String(raw) });
  for (const [k, v] of Object.entries(f.calculated ?? {})) {
    if (k === "masked") continue;
    const label = VALUE_LABELS[k] ?? k;
    const str = typeof v === "number" ? formatDecimal(v, Number.isInteger(v) ? 0 : 2) : String(v).replace(/\|/g, ", ");
    out.push({ label, value: str });
  }
  return out;
}

/**
 * docs/ux-design.md section 4.8 / 7.2. Portal message verbatim; "What to do" from finding-hints.ts
 * (falls back to the Portal message when no hint exists). PRIVATE findings carry a Lock tag.
 */
export function FindingCard({ finding: f, record, compact = false, hideRow = false, className }: FindingCardProps) {
  const sev = SEVERITY_MAP[f.severity];
  const tone = TOKEN_CLASSES[sev.token];
  const Icon = sev.icon;
  const hint = hintFor(f);
  const values = valueEntries(f);
  const yearLabel = f.yearScope === "CURRENT" ? "Current year" : f.yearScope === "PREVIOUS" ? "Previous year" : null;
  const member = record ?? (f.lineNumber ? { lineNumber: f.lineNumber, sinMasked: null } : null);
  return (
    <article data-testid={`finding-card-${f.findingId}`} className={cn("rounded-md border bg-surface-raised", tone.border, compact ? "p-3" : "p-4", className)} aria-label={`${sev.label} finding, rule ${f.ruleId}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <span className={cn("inline-flex items-center gap-1.5 text-small font-medium", tone.text)}>
          <Icon aria-hidden="true" className="h-4 w-4" />
          {sev.label}
          {f.visibility === "PRIVATE" ? (
            <span className="ml-1 inline-flex items-center gap-1 rounded-sm bg-surface px-1.5 py-0.5 text-caption font-medium text-ink-muted">
              <Lock aria-hidden="true" className="h-3 w-3" /> HOOPP-internal
            </span>
          ) : null}
        </span>
        <span className="font-mono text-caption text-ink-muted">
          Rule {f.ruleId} · {f.messageId}
        </span>
      </header>
      {!hideRow && (member || f.field) ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-small text-ink-muted">
          {member?.lineNumber ? <span>Row {member.lineNumber}</span> : <span>File-level</span>}
          {member?.sinMasked ? (
            <>
              <span aria-hidden="true">·</span>
              <MaskedSIN masked={member.sinMasked} initials={initialsOf(member.firstName, member.lastName)} />
            </>
          ) : null}
          {f.field ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Field <code className="rounded-sm bg-surface px-1 font-mono text-caption text-ink">{f.field}</code>
              </span>
            </>
          ) : null}
          {yearLabel ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{yearLabel}</span>
            </>
          ) : null}
        </p>
      ) : null}
      <p className={cn("mt-2 text-body text-ink", compact && "text-small")}>{f.portalMessage}</p>
      {hint ? (
        <p className={cn("mt-2 text-body", compact && "text-small")}>
          <span className="font-medium text-ink">What to do: </span>
          <span className="text-ink [&_code]:rounded-sm [&_code]:bg-surface [&_code]:px-1 [&_code]:font-mono [&_code]:text-caption">
            {renderInlineCode(hint)}
          </span>
        </p>
      ) : null}
      {values.length > 0 ? (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-small">
          {values.map((v) => (
            <div key={v.label} className="flex gap-1">
              <dt className="text-ink-muted">{v.label}:</dt>
              <dd className="font-mono text-ink">{v.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {f.override ? (
        <p className="mt-2 text-small text-ok-text">
          Overridden · {f.override.reason} · by {f.override.actor.replace(/^user:/, "")} · {f.override.at.slice(11, 16)}
        </p>
      ) : null}
      <details className="mt-2 text-small">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform [details[open]_&]:rotate-90" />
          Technical detail
        </summary>
        <div className="mt-2 space-y-1 rounded-sm bg-surface p-3 font-mono text-caption text-ink-muted">
          <p>
            <span className="text-ink-faint">DataImport: </span>
            {f.dataImportMessage}
          </p>
          <p>
            <span className="text-ink-faint">level </span>
            {f.level} <span className="text-ink-faint">visibility </span>
            {f.visibility}
            {f.yearScope ? (
              <>
                {" "}
                <span className="text-ink-faint">yearScope </span>
                {f.yearScope}
              </>
            ) : null}
          </p>
          {Object.keys(f.params ?? {}).length > 0 ? (
            <p>
              <span className="text-ink-faint">params </span>
              {JSON.stringify(f.params)}
            </p>
          ) : null}
          {f.calculated ? (
            <p>
              <span className="text-ink-faint">calculated </span>
              {JSON.stringify(f.calculated)}
            </p>
          ) : null}
        </div>
      </details>
    </article>
  );
}

/** Renders `code` spans from backtick segments without innerHTML. */
export function renderInlineCode(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) => (p.startsWith("`") && p.endsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : <React.Fragment key={i}>{p}</React.Fragment>));
}