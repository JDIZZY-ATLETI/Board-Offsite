import type { IsoDate } from "@/types";

export interface BatchLocator {
  employerId: string;
  batchId: string;
  ingestDate: IsoDate;
}

function partition(zone: string, loc: BatchLocator): string {
  return `${zone}/employer=${loc.employerId}/filetype=events/ingest_date=${loc.ingestDate}/batch=${loc.batchId}`;
}

/** Per-batch lake paths (architecture section 5). */
export function lakePaths(loc: BatchLocator) {
  const raw = partition("raw", loc);
  const bronze = partition("bronze", loc);
  const silver = partition("silver", loc);
  const gold = partition("gold", loc);
  return {
    raw: { dir: raw, original: `${raw}/original.csv`, manifest: `${raw}/manifest.json` },
    bronze: {
      dir: bronze,
      records: `${bronze}/records.ndjson`,
      parseErrors: `${bronze}/parse-errors.ndjson`,
      header: `${bronze}/header.json`,
    },
    silver: {
      dir: silver,
      accepted: `${silver}/accepted.ndjson`,
      rejected: `${silver}/rejected.csv`,
      findings: `${silver}/findings.ndjson`,
      arielSnapshot: `${silver}/ariel-snapshot.ndjson`,
    },
    gold: {
      dir: gold,
      reportsDir: `${gold}/reports`,
      executionReportJson: `${gold}/reports/execution-report.json`,
      executionReportHtml: `${gold}/reports/execution-report.html`,
    },
  } as const;
}

export type LakePaths = ReturnType<typeof lakePaths>;
