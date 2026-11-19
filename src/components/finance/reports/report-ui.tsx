import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBranding } from "@/lib/dal/settings";
import type { ReportKey, ReportMeta } from "@/lib/dal/finance-reports";
import { formatDate } from "@/lib/format";
import { formatAmount, quickAsOfDates, quickRanges } from "@/lib/finance/report-math";
import { cn } from "@/lib/utils";
import { PrintButton } from "./print-button";

/** "YYYY-MM-DD" -> "Jul 1, 2026" (the accounting date is a plain LA calendar day). */
export function fmtIso(iso: string): string {
  return formatDate(new Date(`${iso}T12:00:00Z`));
}

export function rangeText(from: string, to: string): string {
  return `${fmtIso(from)} to ${fmtIso(to)}`;
}

export const NUM = "text-right tabular-nums whitespace-nowrap";

/** Money in a table cell: right-aligned, tabular, negatives in parentheses (red on screen). */
export function Amt({
  cents,
  bold,
  dash = true,
  symbol = false,
  className,
}: {
  cents: number;
  bold?: boolean;
  dash?: boolean;
  symbol?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums", bold && "font-bold", cents < 0 && "text-rose-700 print:text-black", className)}>
      {formatAmount(cents, { dash, symbol })}
    </span>
  );
}

export function exportHref(report: ReportKey, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams({ report });
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return `/finance/reports/export?${sp.toString()}`;
}

/** Page chrome shared by every report: back link, title, CSV + print actions, print-only header. */
export async function ReportFrame({
  title,
  subtitle,
  period,
  csvHref,
  controls,
  children,
}: {
  title: string;
  subtitle: string;
  /** e.g. "Jul 1, 2026 to Jun 30, 2027" or "As of Nov 19, 2026". */
  period: string;
  csvHref?: string;
  controls?: ReactNode;
  children: ReactNode;
}) {
  const branding = await getBranding();
  return (
    <div className="space-y-6">
      <Link
        href="/finance/reports"
        className="print:hidden inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-charcoal"
      >
        <ArrowLeft className="h-4 w-4" /> All reports
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
        </div>
        <div className="print:hidden flex flex-wrap items-center gap-2 shrink-0">
          {csvHref ? (
            <a href={csvHref} className={buttonStyles({ variant: "secondary", size: "sm" })} download>
              <Download className="h-4 w-4" /> Download CSV
            </a>
          ) : null}
          <PrintButton />
        </div>
      </div>
      <div className="hidden print:block text-center">
        <p className="text-lg font-bold">{branding.orgName}</p>
        <p className="text-base font-semibold">{title}</p>
        <p className="text-sm">{period}</p>
      </div>
      {controls}
      {children}
    </div>
  );
}

const chip = (active: boolean) => buttonStyles({ variant: active ? "primary" : "secondary", size: "sm" });

function href(basePath: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * Date controls (a plain GET form, no client JS): quick ranges + custom dates + extra filters.
 * `keep` carries the other filters through the quick-range links.
 */
export function PeriodControls({
  basePath,
  meta,
  mode,
  from,
  to,
  asOf,
  keep = {},
  children,
}: {
  basePath: string;
  meta: ReportMeta;
  mode: "range" | "asof";
  from?: string;
  to?: string;
  asOf?: string;
  keep?: Record<string, string | undefined>;
  children?: ReactNode;
}) {
  const ranges = quickRanges(meta.today, meta.fy, meta.prevFy);
  const asOfs = quickAsOfDates(meta.today, meta.fy, meta.prevFy);
  return (
    <Card className="print:hidden">
      <div className="flex flex-wrap gap-2">
        {mode === "range"
          ? ranges.map((r) => (
              <Link
                key={r.key}
                href={href(basePath, { ...keep, from: r.from, to: r.to })}
                className={chip(r.from === from && r.to === to)}
              >
                {r.label}
              </Link>
            ))
          : asOfs.map((r) => (
              <Link key={r.key} href={href(basePath, { ...keep, asOf: r.asOf })} className={chip(r.asOf === asOf)}>
                {r.label}
              </Link>
            ))}
      </div>
      <form method="get" action={basePath} className="mt-4 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
        {mode === "range" ? (
          <>
            <div>
              <Label htmlFor="rep-from">From</Label>
              <Input id="rep-from" type="date" name="from" defaultValue={from} required />
            </div>
            <div>
              <Label htmlFor="rep-to">To</Label>
              <Input id="rep-to" type="date" name="to" defaultValue={to} required />
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="rep-asof">As of</Label>
            <Input id="rep-asof" type="date" name="asOf" defaultValue={asOf} required />
          </div>
        )}
        {children}
        <Button type="submit" size="md">
          Update report
        </Button>
      </form>
      <p className="mt-3 text-xs text-stone-500">
        Fiscal year: {meta.fy.label} ({fmtIso(meta.fy.from)} to {fmtIso(meta.fy.to)}). Dates are Pacific time.
      </p>
    </Card>
  );
}

/** Table section heading row. */
export function SectionRow({ label, cols }: { label: string; cols: number }) {
  return (
    <tr className="bg-alabaster/70">
      <td colSpan={cols} className="px-2 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-600">
        {label}
      </td>
    </tr>
  );
}
