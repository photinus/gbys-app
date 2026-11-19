import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ActivitiesNetAssets } from "@/lib/dal/finance-reports";
import type { Activities, ActivitiesGroup, Cols } from "@/lib/finance/report-math";
import { Amt, NUM, SectionRow } from "./report-ui";

function ColsCells({ c, bold }: { c: Cols; bold?: boolean }) {
  return (
    <>
      <TD className={NUM}>
        <Amt cents={c.without} bold={bold} />
      </TD>
      <TD className={NUM}>
        <Amt cents={c.with} bold={bold} />
      </TD>
      <TD className={NUM}>
        <Amt cents={c.total} bold={bold} />
      </TD>
    </>
  );
}

function Groups({ groups }: { groups: ActivitiesGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <GroupRows key={g.label} g={g} />
      ))}
    </>
  );
}

function GroupRows({ g }: { g: ActivitiesGroup }) {
  return (
    <>
      <TR>
        <TD colSpan={4} className="pt-4 pb-1 text-sm font-semibold text-stone-700">
          {g.label}
        </TD>
      </TR>
      {g.rows.map((r) => (
        <TR key={r.accountId}>
          <TD className="py-2 pl-5">
            <span className="text-stone-400 tabular-nums mr-2">{r.code}</span>
            {r.name}
          </TD>
          <ColsCells c={r} />
        </TR>
      ))}
      <TR className="border-t border-line">
        <TD className="py-2 pl-5 font-semibold">Total {g.label}</TD>
        <ColsCells c={g.subtotal} bold />
      </TR>
    </>
  );
}

function TotalRow({ label, c, strong }: { label: string; c: Cols; strong?: boolean }) {
  return (
    <TR className={strong ? "border-t-2 border-charcoal bg-alabaster/60" : "border-t border-line"}>
      <TD className="font-bold">{label}</TD>
      <ColsCells c={c} bold />
    </TR>
  );
}

export function ActivitiesTable({ a, netAssets }: { a: Activities; netAssets: ActivitiesNetAssets | null }) {
  const empty = a.revenueGroups.length === 0 && a.expenseGroups.length === 0;
  return (
    <Table>
      <THead>
        <tr>
          <TH className="text-left">&nbsp;</TH>
          <TH className="text-right">Without donor restrictions</TH>
          <TH className="text-right">With donor restrictions</TH>
          <TH className="text-right">Total</TH>
        </tr>
      </THead>
      <TBody>
        <SectionRow label="Revenue and support" cols={4} />
        {a.revenueGroups.length === 0 ? (
          <TR>
            <TD colSpan={4} className="text-stone-500">
              No revenue in this period.
            </TD>
          </TR>
        ) : (
          <Groups groups={a.revenueGroups} />
        )}
        <TotalRow label="Total revenue and support" c={a.totalRevenue} />
        <TR>
          <TD className="py-3">
            Net assets released from restrictions
            <span className="block text-xs text-stone-500">Spending from donor-restricted funds this period, plus any funds released by hand.</span>
          </TD>
          <ColsCells c={a.released} />
        </TR>
        <TotalRow label="Total revenue, support and releases" c={a.totalRevenueAndReleases} />

        <SectionRow label="Expenses" cols={4} />
        {a.expenseGroups.length === 0 ? (
          <TR>
            <TD colSpan={4} className="text-stone-500">
              No expenses in this period.
            </TD>
          </TR>
        ) : (
          <Groups groups={a.expenseGroups} />
        )}
        <TotalRow label="Total expenses" c={a.totalExpenses} />

        <TotalRow label="Change in net assets" c={a.change} strong />
        {netAssets ? (
          <>
            <TR>
              <TD>Net assets, beginning of period</TD>
              <ColsCells c={netAssets.beginning} />
            </TR>
            {netAssets.adjustments.total !== 0 || netAssets.adjustments.without !== 0 || netAssets.adjustments.with !== 0 ? (
              <TR>
                <TD>
                  Opening balances and other adjustments
                  <span className="block text-xs text-stone-500">Entered directly to net asset accounts.</span>
                </TD>
                <ColsCells c={netAssets.adjustments} />
              </TR>
            ) : null}
            <TotalRow label="Net assets, end of period" c={netAssets.ending} strong />
          </>
        ) : null}
        {empty ? (
          <TR>
            <TD colSpan={4} className="py-6 text-center text-stone-500">
              Nothing was posted for these dates and filters.
            </TD>
          </TR>
        ) : null}
      </TBody>
    </Table>
  );
}
