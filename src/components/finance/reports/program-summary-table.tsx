import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ProgramSummary } from "@/lib/finance/report-math";
import { Amt, NUM } from "./report-ui";

export function ProgramSummaryTable({ s }: { s: ProgramSummary }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH className="text-left">Program</TH>
          <TH className="text-right">Revenue</TH>
          <TH className="text-right">Expenses</TH>
          <TH className="text-right">Surplus (deficit)</TH>
        </tr>
      </THead>
      <TBody>
        {s.rows.map((r) => (
          <TR key={r.programId ?? "org"}>
            <TD className="py-3 font-semibold">{r.name}</TD>
            <TD className={NUM}>
              <Amt cents={r.revenueCents} />
            </TD>
            <TD className={NUM}>
              <Amt cents={r.expensesCents} />
            </TD>
            <TD className={NUM}>
              <Amt cents={r.netCents} bold dash={false} />
            </TD>
          </TR>
        ))}
        {s.rows.length === 0 ? (
          <TR>
            <TD colSpan={4} className="py-6 text-center text-stone-500">
              No revenue or expenses in this period.
            </TD>
          </TR>
        ) : null}
        <TR className="border-t-2 border-charcoal bg-alabaster/60">
          <TD className="font-bold">Total</TD>
          <TD className={NUM}>
            <Amt cents={s.totalRevenue} bold dash={false} />
          </TD>
          <TD className={NUM}>
            <Amt cents={s.totalExpenses} bold dash={false} />
          </TD>
          <TD className={NUM}>
            <Amt cents={s.totalNet} bold dash={false} />
          </TD>
        </TR>
      </TBody>
    </Table>
  );
}
