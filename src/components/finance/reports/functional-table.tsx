import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { FunctionalExpenses } from "@/lib/finance/report-math";
import { Amt, NUM } from "./report-ui";

export function FunctionalTable({ f, programNames }: { f: FunctionalExpenses; programNames: Record<string, string> }) {
  const t = f.totals;
  return (
    <div className="space-y-6">
      <Table>
        <THead>
          <tr>
            <TH className="text-left">Expense</TH>
            <TH className="text-right">Program services</TH>
            <TH className="text-right">Management &amp; general</TH>
            <TH className="text-right">Fundraising</TH>
            <TH className="text-right">Total</TH>
          </tr>
        </THead>
        <TBody>
          {f.rows.map((r) => (
            <TR key={r.accountId}>
              <TD className="py-2">
                <span className="text-stone-400 tabular-nums mr-2">{r.code}</span>
                {r.name}
              </TD>
              <TD className={NUM}>
                <Amt cents={r.programCents} />
              </TD>
              <TD className={NUM}>
                <Amt cents={r.managementCents} />
              </TD>
              <TD className={NUM}>
                <Amt cents={r.fundraisingCents} />
              </TD>
              <TD className={NUM}>
                <Amt cents={r.totalCents} bold dash={false} />
              </TD>
            </TR>
          ))}
          {f.rows.length === 0 ? (
            <TR>
              <TD colSpan={5} className="py-6 text-center text-stone-500">
                No expenses in this period.
              </TD>
            </TR>
          ) : null}
          <TR className="border-t-2 border-charcoal bg-alabaster/60">
            <TD className="font-bold">Total expenses</TD>
            <TD className={NUM}>
              <Amt cents={t.programCents} bold dash={false} />
            </TD>
            <TD className={NUM}>
              <Amt cents={t.managementCents} bold dash={false} />
            </TD>
            <TD className={NUM}>
              <Amt cents={t.fundraisingCents} bold dash={false} />
            </TD>
            <TD className={NUM}>
              <Amt cents={t.totalCents} bold dash={false} />
            </TD>
          </TR>
          <TR>
            <TD className="font-semibold text-stone-600">Share of total</TD>
            <TD className={`${NUM} text-stone-600`}>{f.percents.program.toFixed(1)}%</TD>
            <TD className={`${NUM} text-stone-600`}>{f.percents.management.toFixed(1)}%</TD>
            <TD className={`${NUM} text-stone-600`}>{f.percents.fundraising.toFixed(1)}%</TD>
            <TD className={`${NUM} text-stone-600`}>{t.totalCents === 0 ? "0.0%" : "100.0%"}</TD>
          </TR>
        </TBody>
      </Table>
      {f.programServicesByProgram.length > 0 ? (
        <div>
          <h2 className="mb-3 text-lg font-bold">Program services by program</h2>
          <Table>
            <THead>
              <tr>
                <TH className="text-left">Program</TH>
                <TH className="text-right">Expenses</TH>
              </tr>
            </THead>
            <TBody>
              {[...f.programServicesByProgram]
                .sort((a, b) => (programNames[a.programId] ?? "").localeCompare(programNames[b.programId] ?? ""))
                .map((p) => (
                  <TR key={p.programId}>
                    <TD className="py-2.5">{programNames[p.programId] ?? "Unknown program"}</TD>
                    <TD className={NUM}>
                      <Amt cents={p.cents} dash={false} />
                    </TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        </div>
      ) : null}
      <p className="text-xs text-stone-500">
        Expenses tagged to a program count as program services. Fundraising-type accounts count as fundraising. Everything
        else is management &amp; general.
      </p>
    </div>
  );
}
