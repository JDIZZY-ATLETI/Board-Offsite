"use client";

import * as React from "react";
import { useDropzone } from "react-dropzone";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, formatInt, shortHash } from "@/lib/ui/format";
import type { PreflightResult } from "@/lib/ui/preflight";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/app/copy-button";
import { PreflightResultView } from "./preflight-result";

export interface FileDropzoneProps {
  maxBytes: number;
  maxRows?: number;
  onFile(file: File | null): void;
  file: File | null;
  sha256?: string | null;
  preflight?: PreflightResult | null;
  progress?: { phase: "hashing" | "uploading" | "queued"; percent?: number } | null;
  disabled?: boolean;
  error?: string | null;
  className?: string;
}

const PHASE_LABEL = { hashing: "Computing sha256…", uploading: "Uploading…", queued: "Queued — validating…" } as const;

/** docs/ux-design.md section 4.6. Single CSV; keyboard: Enter/Space opens picker, Delete removes. */
export function FileDropzone({ maxBytes, maxRows = 50_000, onFile, file, sha256, preflight, progress, disabled, error, className }: FileDropzoneProps) {
  const [rejection, setRejection] = React.useState<string | null>(null);
  const [live, setLive] = React.useState("");

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: { "text/csv": [".csv"], "application/vnd.ms-excel": [".csv"], "text/plain": [".csv"] },
    multiple: false,
    maxSize: maxBytes,
    disabled,
    noClick: Boolean(file),
    noKeyboard: Boolean(file),
    onDrop: (accepted, rejected) => {
      if (rejected.length) {
        const r = rejected[0];
        const tooBig = r.errors.some((e) => e.code === "file-too-large");
        const msg = tooBig ? `The file is ${formatBytes(r.file.size)}; the limit is ${formatBytes(maxBytes)}. Split it into two files and upload each.` : `Choose a .csv file — "${r.file.name}" isn't a CSV.`;
        setRejection(msg);
        setLive(msg);
        onFile(null);
        return;
      }
      if (accepted[0]) {
        setRejection(null);
        setLive(`Selected ${accepted[0].name}`);
        onFile(accepted[0]);
      }
    },
  });

  const remove = () => {
    onFile(null);
    setRejection(null);
    setLive("File removed");
  };

  React.useEffect(() => {
    if (preflight) setLive(preflight.state === "ok" ? "Header matches the Events layout" : preflight.state === "warn" ? "Header is missing optional columns" : "Header will be rejected");
  }, [preflight]);

  return (
    <div className={cn("space-y-3", className)}>
      <div
        {...getRootProps({
          role: "button",
          tabIndex: disabled ? -1 : 0,
          "aria-label": file ? `Selected file ${file.name}. Press Delete to remove.` : "Drop your Events CSV here or press Enter to browse",
          "aria-disabled": disabled,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (file && (e.key === "Delete" || e.key === "Backspace")) {
              e.preventDefault();
              remove();
            }
          },
        })}
        data-testid="dropzone"
        data-state={file ? (preflight ? `preflight-${preflight.state}` : "file-selected") : isDragActive ? "drag-over" : "idle"}
        className={cn(
          "rounded-md border-2 border-dashed p-6 text-center transition-colors",
          isDragActive ? "border-brand bg-brand-soft" : "border-border bg-surface",
          disabled && "cursor-not-allowed opacity-60",
          !file && !disabled && "cursor-pointer hover:border-brand/60",
        )}
      >
        <input {...getInputProps()} aria-hidden="true" />
        {!file ? (
          <div className="flex flex-col items-center gap-2">
            <Upload aria-hidden="true" className="h-8 w-8 text-ink-faint" strokeWidth={1.5} />
            <p className="text-body text-ink">
              Drop your Events CSV here or{" "}
              <button type="button" onClick={open} disabled={disabled} className="font-medium text-brand underline-offset-2 hover:underline">
                browse
              </button>
            </p>
            <p className="text-small text-ink-muted">
              CSV only · up to {formatBytes(maxBytes)} · up to {formatInt(maxRows)} rows
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-left">
            <div className="flex items-start gap-3">
              <FileSpreadsheet aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-ink" title={file.name}>
                  {file.name}
                </p>
                <p className="text-small text-ink-muted">{formatBytes(file.size)}</p>
                <p className="mt-1 flex items-center gap-1 text-caption text-ink-muted">
                  sha256{" "}
                  {sha256 ? (
                    <>
                      <code className="font-mono text-ink" title={sha256}>
                        {shortHash(sha256)}
                      </code>
                      <CopyButton value={sha256} label="Copy sha256" />
                    </>
                  ) : (
                    <span className="italic">computing…</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="outline" size="sm" onClick={open} disabled={disabled}>
                  Replace
                </Button>
                <Button variant="ghost" size="icon" onClick={remove} disabled={disabled} aria-label="Remove file">
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
            {preflight ? <PreflightResultView result={preflight} className="border-t border-border pt-2" /> : null}
            {progress ? (
              <div className="border-t border-border pt-2">
                <p className="text-small text-ink">{PHASE_LABEL[progress.phase]}</p>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent ?? undefined} aria-label={PHASE_LABEL[progress.phase]} className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div className={cn("h-full rounded-full bg-brand transition-[width]", progress.percent === undefined && "w-1/3 motion-safe:animate-pulse")} style={progress.percent !== undefined ? { width: `${progress.percent}%` } : undefined} />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {rejection || error ? (
        <p role="alert" className="text-small text-sev-cme-text" data-testid="dropzone-error">
          {rejection ?? error}
        </p>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {live}
      </div>
    </div>
  );
}