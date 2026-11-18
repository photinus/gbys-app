import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { RoleCommitments } from "@/lib/dal/grants";
import { formatCents } from "@/lib/format";
import { PERIOD_LABELS } from "@/lib/volunteer-roles";

const hrs = (m: number) => (m / 60).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (p: number | null) => (p === null ? "n/a" : `${p}%`);

/** One-sentence explanation shown with the table (page and print summary). */
export const COMMITMENT_NOTE =
  "Projected value is the expected hours at today's in-kind rate; actual value is the verified hours valued at the rate recorded when each was logged, so the two can differ.";

export function RoleCommitmentsTable({ data }: { data: RoleCommitments }) {
  if (data.rows.length === 0) {
    return <p className="py-4 text-sm text-stone-500">No active or ended volunteer role assignments overlap this date range.</p>;
  }
  const t = data.totals;
  return (
    <Table className="min-w-[760px]">
      <THead>
        <tr>
          <TH>Volunteer role</TH>
          <TH className="text-right">Assignments</TH>
          <TH className="text-right">Expected hrs</TH>
          <TH className="text-right">Verified hrs</TH>
          <TH className="text-right">Fulfilment</TH>
          <TH className="text-right">Projected value</TH>
          <TH className="text-right">Actual value</TH>
        </tr>
      </THead>
      <TBody>
        {data.rows.map((r) => (
          <TR key={r.roleId}>
            <TD>
              <div className="font-medium text-charcoal">{r.roleName}</div>
              <div className="text-xs text-stone-500">
                {r.programName ?? "Org-wide"} · {PERIOD_LABELS[r.period]}
              </div>
            </TD>
            <TD className="text-right tabular-nums">{r.assignments}</TD>
            <TD className="text-right tabular-nums">{hrs(r.expectedMinutes)}</TD>
            <TD className="text-right tabular-nums">{hrs(r.verifiedMinutes)}</TD>
            <TD className="text-right tabular-nums">{pct(r.fulfilmentPercent)}</TD>
            <TD className="text-right tabular-nums">{formatCents(r.projectedValueCents)}</TD>
            <TD className="text-right tabular-nums">{formatCents(r.actualValueCents)}</TD>
          </TR>
        ))}
        <TR className="font-semibold">
          <TD>Total</TD>
          <TD className="text-right tabular-nums">{t.assignments}</TD>
          <TD className="text-right tabular-nums">{hrs(t.expectedMinutes)}</TD>
          <TD className="text-right tabular-nums">{hrs(t.verifiedMinutes)}</TD>
          <TD className="text-right tabular-nums">{pct(t.fulfilmentPercent)}</TD>
          <TD className="text-right tabular-nums">{formatCents(t.projectedValueCents)}</TD>
          <TD className="text-right tabular-nums">{formatCents(t.actualValueCents)}</TD>
        </TR>
      </TBody>
    </Table>
  );
}
