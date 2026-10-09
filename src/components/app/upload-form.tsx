"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/app/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EMPLOYER_NAMES } from "@/lib/auth/dev-session";
import { formatBytes, formatDateTime, shortBatchId } from "@/lib/ui/format";
import { headerTemplateCsv, preflightHeader, readHead, sha256Hex, type PreflightResult } from "@/lib/ui/preflight";
import { DESKTOP_ONLY_NOTE, useIsDesktop } from "@/lib/ui/use-is-desktop";
import { FileDropzone } from "./file-dropzone";
import type { Role } from "@/types";

export interface UploadFormProps {
  role: Role;
  employerId: string | null;
  maxBytes: number;
  maxRows: number;
  today: string;
}

interface DuplicateInfo {
  batchId: string;
  sha256: string;
}

/** docs/ux-design.md section 5.2. POST /api/batches multipart; 202 -> batch page; 200 duplicate -> interstitial. */
export function UploadForm({ role, employerId: fixedEmployer, maxBytes, maxRows, today }: UploadFormProps) {
  const router = useRouter();
  const isAdmin = role === "Admin";
  const [file, setFile] = React.useState<File | null>(null);
  const [sha, setSha] = React.useState<string | null>(null);
  const [preflight, setPreflight] = React.useState<PreflightResult | null>(null);
  const [employerId, setEmployerId] = React.useState(fixedEmployer ?? "");
  const [executionDate, setExecutionDate] = React.useState(today);
  const [uploadAnyway, setUploadAnyway] = React.useState(false);
  const [progress, setProgress] = React.useState<{ phase: "hashing" | "uploading" | "queued"; percent?: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [duplicate, setDuplicate] = React.useState<DuplicateInfo | null>(null);
  const abortRef = React.useRef<XMLHttpRequest | null>(null);

  const onFile = React.useCallback(async (f: File | null) => {
    setFile(f);
    setSha(null);
    setPreflight(null);
    setError(null);
    setDuplicate(null);
    if (!f) return;
    const head = await readHead(f);
    setPreflight(preflightHeader(head.text, head.complete));
    setProgress({ phase: "hashing" });
    try {
      setSha(await sha256Hex(f));
    } finally {
      setProgress(null);
    }
  }, []);

  const isDesktop = useIsDesktop();
  const blocked = !isDesktop || !file || !sha || !preflight || (preflight.state === "error" && !(isAdmin && uploadAnyway)) || preflight.state === "empty" || progress !== null || !employerId;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || blocked) return;
    setError(null);
    setDuplicate(null);
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("employerId", employerId);
    if (isAdmin && executionDate && executionDate !== today) fd.append("executionDate", executionDate);
    const url = "/api/batches";
    setProgress({ phase: "uploading", percent: 0 });
    try {
      const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        abortRef.current = xhr;
        xhr.open("POST", url);
        xhr.responseType = "json";
        xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress({ phase: "uploading", percent: Math.round((ev.loaded / ev.total) * 100) });
        xhr.onload = () => resolve({ status: xhr.status, body: xhr.response });
        xhr.onerror = () => reject(new Error("Network error while uploading"));
        xhr.onabort = () => reject(new Error("aborted"));
        xhr.send(fd);
      });
      abortRef.current = null;
      const body = res.body as { batchId?: string; duplicate?: boolean; sha256?: string; error?: { code?: string; message?: string } };
      if (res.status === 202 || (res.status === 200 && body.batchId && !body.duplicate)) {
        setProgress({ phase: "queued" });
        toast.success("File received — validating now");
        router.push(`/batches/${body.batchId}`);
        return;
      }
      if (res.status === 200 && body.duplicate && body.batchId) {
        setProgress(null);
        setDuplicate({ batchId: body.batchId, sha256: body.sha256 ?? sha ?? "" });
        return;
      }
      setProgress(null);
      setError(friendlyError(res.status, body.error, file, maxBytes));
    } catch (err) {
      setProgress(null);
      if (err instanceof Error && err.message === "aborted") return;
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(null);
  };

  const downloadTemplate = () => {
    const blob = new Blob([headerTemplateCsv()], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "events-header-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const employerLabel = (id: string) => `${id}${EMPLOYER_NAMES[id] ? ` — ${EMPLOYER_NAMES[id]}` : ""}`;

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" aria-describedby="upload-help" noValidate>
      <div className="space-y-6">
        <section aria-labelledby="step-file" className="space-y-3">
          <h2 id="step-file" className="flex items-center gap-2 text-h2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-caption text-white">1</span> File
          </h2>
          {!isDesktop ? (
            <Alert variant="info" title="Read-only on small screens" data-testid="desktop-only-note">
              {DESKTOP_ONLY_NOTE}.
            </Alert>
          ) : null}
          <FileDropzone maxBytes={maxBytes} maxRows={maxRows} file={file} onFile={onFile} sha256={sha} preflight={preflight} progress={progress} disabled={!isDesktop || progress?.phase === "uploading" || progress?.phase === "queued"} />
          {preflight?.state === "error" && isAdmin ? (
            <div className="flex items-center gap-2">
              <Checkbox id="force-header" checked={uploadAnyway} onCheckedChange={(c) => setUploadAnyway(Boolean(c))} />
              <Label htmlFor="force-header" className="text-small font-normal text-ink-muted">
                Upload anyway to record a FILE_REJECTED batch (Admin)
              </Label>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="step-details" className="space-y-3">
          <h2 id="step-details" className="flex items-center gap-2 text-h2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-caption text-white">2</span> Details
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="employer">Employer{isAdmin ? " (required)" : ""}</Label>
              {isAdmin ? (
                <Input id="employer" value={employerId} onChange={(e) => setEmployerId(e.target.value.trim())} placeholder="0235" pattern="[A-Za-z0-9_-]{1,32}" list="employer-options" className="font-mono" required />
              ) : (
                <p id="employer" className="flex h-9 items-center rounded-sm border border-border bg-surface px-3 text-body text-ink">
                  {employerLabel(employerId)}
                </p>
              )}
              <datalist id="employer-options">
                {Object.keys(EMPLOYER_NAMES).map((id) => (
                  <option key={id} value={id}>
                    {EMPLOYER_NAMES[id]}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="execution-date" className="flex items-center gap-1">
                Execution date
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="About execution date" className="rounded-full text-ink-faint hover:text-ink">
                      <Info aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>The date rules evaluate &ldquo;today&rdquo; against (e.g. I42 future-date check). Admins may override it.</TooltipContent>
                </Tooltip>
              </Label>
              {isAdmin ? (
                <Input id="execution-date" type="date" value={executionDate} onChange={(e) => setExecutionDate(e.target.value)} className="font-mono" />
              ) : (
                <p id="execution-date" className="flex h-9 items-center rounded-sm border border-border bg-surface px-3 text-body text-ink">
                  {today} <span className="ml-1 text-ink-muted">(today)</span>
                </p>
              )}
            </div>
          </div>
        </section>

        {error ? (
          <Alert variant="error" title="Upload didn't go through">
            {error}
          </Alert>
        ) : null}

        {duplicate ? (
          <Alert
            variant="info"
            title="This exact file was already uploaded"
            actions={
              <>
                <Button asChild size="sm">
                  <Link href={`/batches/${duplicate.batchId}`}>Open existing batch</Link>
                </Button>
              </>
            }
            data-testid="duplicate-interstitial"
          >
            Same bytes as batch <code className="font-mono">{shortBatchId(duplicate.batchId)}</code>. No new batch was created; the ledger recorded the re-upload on the existing batch.
          </Alert>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {progress?.phase === "uploading" ? (
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="ghost" asChild>
              <Link href="/batches">Cancel</Link>
            </Button>
          )}
          <Button type="submit" disabled={blocked} data-testid="upload-submit">
            {progress?.phase === "uploading" ? "Uploading…" : progress?.phase === "queued" ? "Queued…" : "Upload and validate"}
          </Button>
        </div>
      </div>

      <aside id="upload-help" className="space-y-5 text-small">
        <div className="rounded-md border border-border bg-surface-raised p-4">
          <h3 className="text-h3">Before you upload</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
            <li>CSV with the 15-column Events header</li>
            <li>
              Dates as <code className="font-mono text-ink">MMDDYYYY</code> (e.g. 09302026)
            </li>
            <li>One row per member</li>
            <li>SIN without hyphens</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              Download header template .csv
            </Button>
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface-raised p-4">
          <h3 className="text-h3">What happens next</h3>
          <p className="mt-2 text-ink-muted">Received → Parsed → Validated → Update Set → HOOPP review → Export. Results usually in under a minute for typical files.</p>
          <p className="mt-2 text-caption text-ink-faint">The header check on this page is advisory; the server&apos;s file-layout rules (I50/I51) are authoritative.</p>
        </div>
        <p className="text-caption text-ink-faint">Local time now: {formatDateTime(new Date())}</p>
      </aside>
    </form>
  );
}

function friendlyError(status: number, err: { code?: string; message?: string } | undefined, file: File, maxBytes: number): string {
  switch (err?.code ?? status) {
    case "PAYLOAD_TOO_LARGE":
    case 413:
      if (err?.code === "TOO_MANY_ROWS") return "The file has more than the allowed number of rows. Split it into two files and upload each.";
      if (err?.code === "LINE_TOO_LONG") return "A line in the file is longer than allowed (4,096 bytes). Check for a row with runaway text and fix it.";
      return `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}. Split it into two files and upload each.`;
    case "UNSUPPORTED_MEDIA_TYPE":
    case 415:
      return "Only .csv files are accepted. Save the file as CSV (comma separated) and upload again.";
    case "FORBIDDEN":
    case 403:
      return "You can only upload for your own employer.";
    case "UNAUTHENTICATED":
    case 401:
      return "Your session has ended. Sign in again from the Dev login page.";
    default:
      return err?.message ?? `Upload failed (HTTP ${status}).`;
  }
}