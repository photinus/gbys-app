import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { GrantBucket, GrantReport } from "@/lib/dal/grants";
import { formatCents } from "@/lib/format";
import { CATEGORY_LABELS, type VolunteerCategory } from "@/lib/volunteer-categories";

const hrs = (m: number) => (m / 60).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function BucketTable({
  firstHeader,
  rows,
  label,
  total,
}: {
  firstHeader: string;
  rows: GrantBucket[];
  label?: (b: GrantBucket) => string;
  total: GrantReport["totals"];
}) {
  if (rows.length === 0) return <p className="py-4 text-sm text-stone-500">No entries match these filters.</p>;
  return (
    <Table className="min-w-[420px]">
      <THead>
        <tr>
          <TH>{firstHeader}</TH>
          <TH className="text-right">Entries</TH>
          <TH className="text-right">Hours</TH>
          <TH className="text-right">In-kind value</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((b) => (
          <TR key={b.key}>
            <TD>{label ? label(b) : b.label}</TD>
            <TD className="text-right tabular-nums">{b.entries}</TD>
            <TD className="text-right tabular-nums">{hrs(b.minutes)}</TD>
            <TD className="text-right tabular-nums">{formatCents(b.valueCents)}</TD>
          </TR>
        ))}
        <TR className="font-semibold">
          <TD>Total</TD>
          <TD className="text-right tabular-nums">{total.entries}</TD>
          <TD className="text-right tabular-nums">{hrs(total.minutes)}</TD>
          <TD className="text-right tabular-nums">{formatCents(total.valueCents)}</TD>
        </TR>
      </TBody>
    </Table>
  );
}

export function CategoryTable({ report }: { report: GrantReport }) {
  return (
    <BucketTable
      firstHeader="Category"
      rows={report.byCategory}
      label={(b) => CATEGORY_LABELS[b.key as VolunteerCategory] ?? b.key}
      total={report.totals}
    />
  );
}

export function ProgramTable({ report }: { report: GrantReport }) {
  return <BucketTable firstHeader="Program" rows={report.byProgram} total={report.totals} />;
}

export function RoleTable({ report }: { report: GrantReport }) {
  if (report.byRole.length === 0) return <p className="py-4 text-sm text-stone-500">No entries match these filters.</p>;
  const t = report.totals;
  return (
    <Table className="min-w-[520px]">
      <THead>
        <tr>
          <TH>Volunteer role</TH>
          <TH className="text-right">Entries</TH>
          <TH className="text-right">Hours</TH>
          <TH className="text-right">In-kind value</TH>
        </tr>
      </THead>
      <TBody>
        {report.byRole.map((b) => (
          <TR key={b.key}>
            <TD>
              <div className="font-medium text-charcoal">{b.label}</div>
              {b.programName ? <div className="text-xs text-stone-500">{b.programName}</div> : null}
            </TD>
            <TD className="text-right tabular-nums">{b.entries}</TD>
            <TD className="text-right tabular-nums">{hrs(b.minutes)}</TD>
            <TD className="text-right tabular-nums">{formatCents(b.valueCents)}</TD>
          </TR>
        ))}
        <TR className="font-semibold">
          <TD>Total</TD>
          <TD className="text-right tabular-nums">{t.entries}</TD>
          <TD className="text-right tabular-nums">{hrs(t.minutes)}</TD>
          <TD className="text-right tabular-nums">{formatCents(t.valueCents)}</TD>
        </TR>
      </TBody>
    </Table>
  );
}

export function MonthTable({ report }: { report: GrantReport }) {
  return <BucketTable firstHeader="Month (Pacific)" rows={report.byMonth} total={report.totals} />;
}

export function VolunteerTable({ report }: { report: GrantReport }) {
  if (report.byVolunteer.length === 0) return <p className="py-4 text-sm text-stone-500">No entries match these filters.</p>;
  const t = report.totals;
  return (
    <Table className="min-w-[520px]">
      <THead>
        <tr>
          <TH>Volunteer</TH>
          <TH className="text-right">Entries</TH>
          <TH className="text-right">Hours</TH>
          <TH className="text-right">In-kind value</TH>
        </tr>
      </THead>
      <TBody>
        {report.byVolunteer.map((v) => (
          <TR key={v.userId}>
            <TD>
              <div className="font-medium text-charcoal">{v.name}</div>
              <div className="text-xs text-stone-500">{v.email}</div>
            </TD>
            <TD className="text-right tabular-nums">{v.entries}</TD>
            <TD className="text-right tabular-nums">{hrs(v.minutes)}</TD>
            <TD className="text-right tabular-nums">{formatCents(v.valueCents)}</TD>
          </TR>
        ))}
        <TR className="font-semibold">
          <TD>Total ({t.volunteers} volunteers)</TD>
          <TD className="text-right tabular-nums">{t.entries}</TD>
          <TD className="text-right tabular-nums">{hrs(t.minutes)}</TD>
          <TD className="text-right tabular-nums">{formatCents(t.valueCents)}</TD>
        </TR>
      </TBody>
    </Table>
  );
}

/** Plain-language statement of how value was computed (shown on the page and the print summary). */
export function rateStatement(report: GrantReport): string {
  const rates = report.rates.map((r) => `${formatCents(r)}/hr`).join(", ");
  const base = rates
    ? `Each entry is valued at the Independent Sector volunteer hourly rate recorded when it was logged (${rates} in this report), rounded to the nearest cent per entry.`
    : "Each entry is valued at the Independent Sector volunteer hourly rate recorded when it was logged, rounded to the nearest cent per entry.";
  return report.fallbackRateEntries > 0
    ? `${base} ${report.fallbackRateEntries} ${report.fallbackRateEntries === 1 ? "entry has" : "entries have"} no recorded rate and use the current rate of ${formatCents(report.currentRateCents)}/hr.`
    : base;
}
