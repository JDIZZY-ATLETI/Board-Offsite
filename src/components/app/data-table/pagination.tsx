"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatInt } from "@/lib/ui/format";

export interface CursorPaginationProps {
  mode: "cursor";
  shown: number;
  hasNext: boolean;
  hasPrev: boolean;
  onNext(): void;
  onPrev(): void;
  pageSize: number;
}

export interface ClientPaginationProps {
  mode: "client";
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange(i: number): void;
}

export type PaginationProps = CursorPaginationProps | ClientPaginationProps;

/** "Showing 50 · more available" for cursor mode; "Showing 1–50 of 1,240" for client mode. */
export function Pagination(props: PaginationProps) {
  if (props.mode === "cursor") {
    return (
      <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2 text-small text-ink-muted">
        <span>
          Showing {formatInt(props.shown)}
          {props.hasNext ? " · more available" : ""}
        </span>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={props.onPrev} disabled={!props.hasPrev} aria-label="Previous page">
            <ChevronLeft aria-hidden="true" /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={props.onNext} disabled={!props.hasNext} aria-label="Next page">
            Next <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }
  const from = props.total === 0 ? 0 : props.pageIndex * props.pageSize + 1;
  const to = Math.min(props.total, (props.pageIndex + 1) * props.pageSize);
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2 text-small text-ink-muted">
      <span>
        Showing {formatInt(from)}–{formatInt(to)} of {formatInt(props.total)}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" onClick={() => props.onPageChange(props.pageIndex - 1)} disabled={props.pageIndex === 0} aria-label="Previous page">
          <ChevronLeft aria-hidden="true" /> Prev
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.onPageChange(props.pageIndex + 1)} disabled={props.pageIndex >= props.pageCount - 1} aria-label="Next page">
          Next <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}