import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { FundBalanceRow, FundBalances } from "@/lib/finance/report-math";
import { Amt, NUM } from "./report-ui";

function FundRow({ f, programName, showAdj, showRel }: { f: FundBalanceRow; programName?: string; showAdj: boolean; showRel: boolean }) {
  return (
    <TR className={f.negative ? "bg-rose-50" : undefined}>
      <TD className="py-2.5">
        <span className="font-semibold">{f.name}</span>
        {programName ? <span className="block text-xs text-stone-500">{programName}</span> : null}
        {f.negative ? (
          <Badge tone="danger" className="mt-1">
            <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
            {f.restricted ? "Overspent — more spent than the donor gave" : "Deficit"}
          </Badge>
        ) : null}
      </TD>
      <TD className={NUM}>
        <Amt cents={f.openingCents} dash={false} />
      </TD>
      {showAdj ? (
        <TD className={NUM}>
          <Amt cents={f.adjustmentsCents} />
        </TD>
      ) : null}
      <TD className={NUM}>
        <Amt cents={f.revenueCents} />
      </TD>
      <TD className={NUM}>
        <Amt cents={-f.expensesCents} />
      </TD>
      {showRel ? (
        <TD className={NUM}>
          <Amt cents={-f.releasesCents} />
        </TD>
      ) : null}
      <TD className={NUM}>
        <Amt cents={f.closingCents} bold dash={false} />
      </TD>
    </TR>
  );
}

export function FundBalancesTable({ b, programNames }: { b: FundBalances; programNames: Record<string, string> }) {
  const showAdj = b.rows.some((r) => r.adjustmentsCents !== 0);
  const restricted = b.rows.filter((r) => r.restricted);
  const unrestricted = b.rows.filter((r) => !r.restricted);
  const showRel = b.rows.some((r) => r.releasesCents !== 0);
  const cols = 5 + (showAdj ? 1 : 0) + (showRel ? 1 : 0);
  return (
    <Table>
      <THead>
        <tr>
          <TH className="text-left">Fund</TH>
          <TH className="text-right">Opening balance</TH>
          {showAdj ? <TH className="text-right">Opening balances &amp; transfers</TH> : null}
          <TH className="text-right">Revenue</TH>
          <TH className="text-right">Spent (released)</TH>
          {showRel ? <TH className="text-right">Released to / from General Fund</TH> : null}
          <TH className="text-right">Closing balance</TH>
        </tr>
      </THead>
      <TBody>
        {restricted.length ? (
          <>
            <tr className="bg-alabaster/70">
              <td colSpan={cols} className="px-2 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-600">
                With donor restrictions
              </td>
            </tr>
            {restricted.map((f) => (
              <FundRow key={f.fundId} f={f} programName={programNames[f.fundId]} showAdj={showAdj} showRel={showRel} />
            ))}
            <TR className="border-t border-line">
              <TD className="font-bold">Total with donor restrictions</TD>
              <TD colSpan={cols - 2} />
              <TD className={NUM}>
                <Amt cents={b.totalRestricted} bold dash={false} />
              </TD>
            </TR>
          </>
        ) : null}
        {unrestricted.length ? (
          <>
            <tr className="bg-alabaster/70">
              <td colSpan={cols} className="px-2 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-600">
                Without donor restrictions
              </td>
            </tr>
            {unrestricted.map((f) => (
              <FundRow key={f.fundId} f={f} programName={programNames[f.fundId]} showAdj={showAdj} showRel={showRel} />
            ))}
            <TR className="border-t border-line">
              <TD className="font-bold">Total without donor restrictions</TD>
              <TD colSpan={cols - 2} />
              <TD className={NUM}>
                <Amt cents={b.totalUnrestricted} bold dash={false} />
              </TD>
            </TR>
          </>
        ) : null}
        {b.rows.length === 0 ? (
          <TR>
            <TD colSpan={cols} className="py-6 text-center text-stone-500">
              No fund activity yet.
            </TD>
          </TR>
        ) : null}
      </TBody>
    </Table>
  );
}
