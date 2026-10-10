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
/**
 * Lake date folder for a batch. Always derived from the UTC instant so the pipeline (which reads the DB
 * timestamp rendered in the session time zone) and the API (ISO string) agree on the same folder.
 */
export function ingestDateOf(receivedAt: string | Date): IsoDate {
  return new Date(receivedAt).toISOString().slice(0, 10) as IsoDate;
}

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
      rulesConfig: `${silver}/rules-config.json`,
    },
    gold: {
      dir: gold,
      reportsDir: `${gold}/reports`,
      executionReportJson: `${gold}/reports/execution-report.json`,
      executionReportHtml: `${gold}/reports/execution-report.html`,
      summaryOfValidations: `${gold}/reports/summary-of-validations.csv`,
      summaryOfValidationsPrivate: `${gold}/reports/summary-of-validations.private.csv`,
    },
  } as const;
}

export type LakePaths = ReturnType<typeof lakePaths>;
