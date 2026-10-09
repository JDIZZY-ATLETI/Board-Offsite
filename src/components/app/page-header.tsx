import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabsNav, type TabItem } from "./tabs-nav";

export interface Breadcrumb {
  label: React.ReactNode;
  href?: string;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  /** Visually-hidden full title (e.g. full batch id) appended inside the h1. */
  srTitle?: string;
  description?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  /** Small inline facts rendered as a <dl>. */
  meta?: Array<{ label: string; value: React.ReactNode }>;
  actions?: React.ReactNode;
  tabs?: TabItem[];
  tabsLabel?: string;
  className?: string;
}

/** docs/ux-design.md section 4.2. Renders the page's single <h1>. */
export function PageHeader({ title, srTitle, description, breadcrumbs, meta, actions, tabs, tabsLabel = "Sections", className }: PageHeaderProps) {
  return (
    <header data-testid="page-header" className={cn("border-b border-border bg-background", className)}>
      <div className="flex flex-col gap-3 pb-4">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="text-small text-ink-muted">
            <ol className="flex flex-wrap items-center gap-1">
              {breadcrumbs.map((b, i) => (
                <li key={i} className="flex items-center gap-1">
                  {i > 0 ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-faint" /> : null}
                  {b.href ? (
                    <Link href={b.href} className="rounded-sm hover:text-ink hover:underline">
                      {b.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-ink">
                      {b.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-h1 text-ink">
              {title}
              {srTitle ? <span className="sr-only"> {srTitle}</span> : null}
            </h1>
            {description ? <p className="max-w-3xl text-body text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {meta && meta.length > 0 ? (
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-small text-ink-muted">
            {meta.map((m) => (
              <div key={m.label} className="flex items-center gap-1.5">
                <dt className="sr-only">{m.label}</dt>
                <dd className="flex items-center gap-1.5">{m.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {tabs && tabs.length > 0 ? <TabsNav tabs={tabs} label={tabsLabel} /> : null}
    </header>
  );
}