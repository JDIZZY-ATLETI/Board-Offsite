"use client";

import * as React from "react";
import { Check, CircleAlert, FileX, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatTime, actorLabel } from "@/lib/ui/format";
import { BATCH_STATUS_MAP, PIPELINE_STEPS, TOKEN_CLASSES } from "@/lib/ui/status-map";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BatchStatus } from "@/types";

export interface StepperTimelineProps {
  status: BatchStatus;
  heldCount: number;
  history: { toStatus: BatchStatus; at: string; actor: string; note?: string | null }[];
  orientation?: "horizontal" | "vertical";
  failureReason?: string;
  className?: string;
}

type NodeState = "done" | "current" | "upcoming" | "bad";

interface StepNode {
  key: string;
  status: BatchStatus;
  label: string;
  state: NodeState;
  at?: string;
  actor?: string;
  note?: string | null;
  detail?: string;
}

/** Builds the fixed-order step list with branch nodes for FILE_REJECTED / FAILED / REJECTED (section 4.7). */
export function buildSteps(status: BatchStatus, heldCount: number, history: StepperTimelineProps["history"], failureReason?: string): StepNode[] {
  const lastReach = new Map<BatchStatus, StepperTimelineProps["history"][number]>();
  for (const h of history) lastReach.set(h.toStatus, h);
  const idx = (s: BatchStatus) => PIPELINE_STEPS.indexOf(s);

  if (status === "FILE_REJECTED") {
    const received = lastReach.get("RECEIVED");
    const rejected = lastReach.get("FILE_REJECTED");
    return [
      { key: "RECEIVED", status: "RECEIVED", label: "Received", state: "done", at: received?.at, actor: received?.actor, note: received?.note },
      { key: "FILE_REJECTED", status: "FILE_REJECTED", label: "File rejected", state: "bad", at: rejected?.at, actor: rejected?.actor, note: rejected?.note, detail: rejected?.note ?? undefined },
      ...PIPELINE_STEPS.slice(2).map<StepNode>((s) => ({ key: s, status: s, label: BATCH_STATUS_MAP[s].label, state: "upcoming" })),
    ];
  }

  // Effective progress position: FAILED/REJECTED attach to the last reached main step.
  let reachedIdx = -1;
  for (const s of PIPELINE_STEPS) if (lastReach.has(s)) reachedIdx = Math.max(reachedIdx, idx(s));
  if (reachedIdx === -1) reachedIdx = 0;
  const currentIdx = status === "FAILED" || status === "REJECTED" ? reachedIdx : idx(status);

  const nodes: StepNode[] = PIPELINE_STEPS.map((s, i) => {
    const h = lastReach.get(s);
    let state: NodeState = i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming";
    if (status === "EXPORTED" && i === currentIdx) state = "done";
    const label = s === "VALIDATED" && state === "current" && heldCount > 0 ? `Validated · ${heldCount} held` : BATCH_STATUS_MAP[s].label;
    const detail = s === "VALIDATED" && state === "current" && heldCount > 0 ? `${heldCount} held row${heldCount === 1 ? "" : "s"} need an override` : undefined;
    return { key: s, status: s, label, state, at: h?.at, actor: h?.actor, note: h?.note, detail };
  });

  if (status === "FAILED") {
    const h = lastReach.get("FAILED");
    nodes[currentIdx] = { ...nodes[currentIdx], state: "done" };
    nodes.splice(currentIdx + 1, 0, { key: "FAILED", status: "FAILED", label: "Failed", state: "bad", at: h?.at, actor: h?.actor, note: h?.note, detail: failureReason ?? h?.note ?? undefined });
  }
  if (status === "REJECTED") {
    const h = lastReach.get("REJECTED");
    const pa = idx("PENDING_APPROVAL");
    nodes[pa] = { ...nodes[pa], state: "done" };
    nodes.splice(pa + 1, 0, { key: "REJECTED", status: "REJECTED", label: "Rejected by reviewer", state: "bad", at: h?.at, actor: h?.actor, note: h?.note, detail: h?.note ?? undefined });
  }
  return nodes;
}

const STATE_DOT: Record<NodeState, string> = {
  done: `${TOKEN_CLASSES.ok.solid} text-white`,
  current: `${TOKEN_CLASSES["st-transient"].solid} text-white`,
  upcoming: "border border-border bg-surface text-ink-faint",
  bad: `${TOKEN_CLASSES["st-bad"].solid} text-white`,
};

/** <ol> with aria-current="step"; pulse is motion-safe only (P8). */
export function StepperTimeline({ status, heldCount, history, orientation = "horizontal", failureReason, className }: StepperTimelineProps) {
  const steps = buildSteps(status, heldCount, history, failureReason);
  const attention = status === "VALIDATED" && heldCount > 0;
  const horizontal = orientation === "horizontal";
  return (
    <ol aria-label="Pipeline progress" className={cn(horizontal ? "flex items-start gap-0 overflow-x-auto py-2" : "flex flex-col gap-0", className)} data-testid="stepper">
      {steps.map((s, i) => {
        const Icon = s.state === "done" ? Check : s.state === "bad" ? (s.status === "FILE_REJECTED" ? FileX : s.status === "REJECTED" ? Ban : CircleAlert) : BATCH_STATUS_MAP[s.status].icon;
        const isCurrent = s.state === "current";
        const dotClass = isCurrent && attention ? `${TOKEN_CLASSES["st-attention"].solid} text-white` : STATE_DOT[s.state];
        const connectorDone = s.state === "done" || s.state === "bad";
        const node = (
          <button
            type="button"
            className={cn("group flex rounded-sm text-left", horizontal ? "flex-col items-center gap-1.5" : "flex-row items-start gap-3")}
            aria-current={isCurrent ? "step" : undefined}
            data-testid={`stepper-step-${s.status}`}
            data-state={s.state}
          >
            <span className={cn("relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full", dotClass)}>
              {isCurrent ? <span aria-hidden="true" className={cn("absolute inset-0 rounded-full opacity-40 motion-safe:animate-pulse-dot", attention ? TOKEN_CLASSES["st-attention"].solid : TOKEN_CLASSES["st-transient"].solid)} /> : null}
              <Icon aria-hidden="true" className="relative h-3.5 w-3.5" />
            </span>
            <span className={cn("leading-tight", horizontal ? "w-[7.5rem] text-center" : "pt-1")}>
              <span className={cn("block text-small", s.state === "upcoming" ? "text-ink-faint" : s.state === "bad" ? "font-medium text-sev-cme-text" : isCurrent ? "font-medium text-ink" : "text-ink")}>
                {s.label}
                <span className="sr-only">{s.state === "done" ? " (done)" : isCurrent ? " (current)" : s.state === "bad" ? " (failed)" : " (upcoming)"}</span>
              </span>
              {s.at ? (
                <time dateTime={s.at} title={formatDateTime(s.at, { seconds: true })} className="block text-caption tabular-nums text-ink-muted">
                  {formatTime(s.at)}
                </time>
              ) : null}
              {s.detail && !horizontal ? <span className="block text-caption text-ink-muted">{s.detail}</span> : null}
            </span>
          </button>
        );
        return (
          <li key={s.key} className={cn("flex", horizontal ? "flex-row items-start" : "flex-col")}>
            {s.at || s.detail || s.note ? (
              <Tooltip>
                <TooltipTrigger asChild>{node}</TooltipTrigger>
                <TooltipContent side={horizontal ? "bottom" : "right"} className="space-y-0.5">
                  <p className="font-medium">{s.label}</p>
                  {s.at ? <p className="text-ink-muted">{formatDateTime(s.at, { seconds: true })}</p> : null}
                  {s.actor ? <p className="text-ink-muted">by {actorLabel(s.actor)}</p> : null}
                  {s.detail ?? s.note ? <p className="max-w-xs break-words">{s.detail ?? s.note}</p> : null}
                </TooltipContent>
              </Tooltip>
            ) : (
              node
            )}
            {i < steps.length - 1 ? (
              <span aria-hidden="true" className={cn(horizontal ? "mt-3.5 h-px w-6 shrink-0 sm:w-8" : "ml-3.5 h-6 w-px", connectorDone ? "bg-ok" : "bg-border")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}