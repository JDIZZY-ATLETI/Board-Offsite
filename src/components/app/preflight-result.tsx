import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PreflightResult } from "@/lib/ui/preflight";
import { EVENTS_CSV_COLUMNS } from "@/types/events";

export interface PreflightResultProps {
  result: PreflightResult;
  className?: string;
}

/** docs/ux-design.md section 5.2 pre-flight outcomes. Advisory; the server's L0 rules are authoritative. */
export function PreflightResultView({ result: r, className }: PreflightResultProps) {
  const rows = r.sampleComplete ? `${r.rowCountSample} data row${r.rowCountSample === 1 ? "" : "s"}` : `${r.rowCountSample}+ data rows (sampled)`;
  if (r.state === "ok") {
    return (
      <p className={cn("flex items-start gap-2 text-small text-ok-text", className)} data-testid="preflight-ok">
        <CircleCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Header matches the Events layout — {EVENTS_CSV_COLUMNS.length} columns · {rows}
          {r.bom ? " · UTF-8 BOM detected (fine)" : ""}
        </span>
      </p>
    );
  }
  if (r.state === "warn") {
    return (
      <p className={cn("flex items-start gap-2 text-small text-sev-warn-text", className)} data-testid="preflight-warn">
        <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Header is missing {r.missingOptional.length} optional column{r.missingOptional.length === 1 ? "" : "s"} ({r.missingOptional.map((c) => <code key={c} className="font-mono">{c}</code>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}) — allowed; those fields will be treated as blank. {rows}.
        </span>
      </p>
    );
  }
  if (r.state === "empty") {
    return (
      <p className={cn("flex items-start gap-2 text-small text-sev-cme-text", className)} data-testid="preflight-error">
        <CircleX aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>The file is empty (no header line). Export the Events file again and upload it.</span>
      </p>
    );
  }
  return (
    <div className={cn("space-y-1 text-small text-sev-cme-text", className)} data-testid="preflight-error">
      <p className="flex items-start gap-2 font-medium">
        <CircleX aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>This header will be rejected (I51).</span>
      </p>
      <ul className="ml-6 list-disc space-y-0.5">
        {r.unknown.length ? (
          <li>
            Unknown columns: {r.unknown.map((u, i) => (
              <span key={u}>
                {i ? ", " : ""}
                <code className="font-mono">{u}</code>
                {r.suggestions[u] ? (
                  <>
                    {" "}
                    — did you mean <code className="font-mono">{r.suggestions[u]}</code>?
                  </>
                ) : null}
              </span>
            ))}
          </li>
        ) : null}
        {r.duplicates.length ? (
          <li>
            Duplicate columns: {r.duplicates.map((d, i) => (
              <span key={d}>
                {i ? ", " : ""}
                <code className="font-mono">{d}</code>
              </span>
            ))}
          </li>
        ) : null}
        {r.missing.length ? (
          <li>
            Missing required columns: {r.missing.map((m, i) => (
              <span key={m}>
                {i ? ", " : ""}
                <code className="font-mono">{m}</code>
              </span>
            ))}
          </li>
        ) : null}
      </ul>
    </div>
  );
}