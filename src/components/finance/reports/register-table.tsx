import Link from "next/link";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { RegisterLine } from "@/lib/dal/finance-reports";
import type { RegisterResult } from "@/lib/finance/report-math";
import { Amt, NUM, fmtIso } from "./report-ui";

export function RegisterTable({
  reg,
  from,
  to,
  linkEntries,
}: {
  reg: RegisterResult<RegisterLine>;
  from: string;
  to: string;
  linkEntries: boolean;
}) {
  return (
    <Table className="min-w-[860px]">
      <THead>
        <tr>
          <TH className="text-left">Date</TH>
          <TH className="text-left">Entry</TH>
          <TH className="text-left">Description</TH>
          <TH className="text-left">Fund</TH>
          <TH className="text-left">Program</TH>
          <TH className="text-right">Debit</TH>
          <TH className="text-right">Credit</TH>
          <TH className="text-right">Balance</TH>
        </tr>
      </THead>
      <TBody>
        <TR className="bg-alabaster/60">
          <TD className="py-2 whitespace-nowrap">{fmtIso(from)}</TD>
          <TD colSpan={4} className="py-2 font-semibold">
            Opening balance
          </TD>
          <TD />
          <TD />
          <TD className={NUM}>
            <Amt cents={reg.openingCents} bold dash={false} />
          </TD>
        </TR>
        {reg.rows.map((l) => (
          <TR key={l.lineId}>
            <TD className="py-2 whitespace-nowrap">{fmtIso(l.entryDate)}</TD>
            <TD className="py-2 whitespace-nowrap">
              {linkEntries ? (
                <Link href={`/finance/journal/${l.entryId}`} className="font-semibold text-indigo-700 hover:underline">
                  #{l.entryNumber}
                </Link>
              ) : (
                <span className="font-semibold">#{l.entryNumber}</span>
              )}
            </TD>
            <TD className="py-2">
              {l.memo}
              {l.description ? <span className="block text-xs text-stone-500">{l.description}</span> : null}
            </TD>
            <TD className="py-2">{l.fundName}</TD>
            <TD className="py-2">{l.programName ?? <span className="text-stone-400">–</span>}</TD>
            <TD className={NUM}>
              <Amt cents={l.debitCents} />
            </TD>
            <TD className={NUM}>
              <Amt cents={l.creditCents} />
            </TD>
            <TD className={NUM}>
              <Amt cents={l.balanceCents} dash={false} />
            </TD>
          </TR>
        ))}
        {reg.rows.length === 0 ? (
          <TR>
            <TD colSpan={8} className="py-6 text-center text-stone-500">
              No activity in this period.
            </TD>
          </TR>
        ) : null}
        <TR className="border-t-2 border-charcoal bg-alabaster/60">
          <TD className="whitespace-nowrap font-bold">{fmtIso(to)}</TD>
          <TD colSpan={4} className="font-bold">
            Closing balance (totals for the period)
          </TD>
          <TD className={NUM}>
            <Amt cents={reg.totalDebits} bold dash={false} />
          </TD>
          <TD className={NUM}>
            <Amt cents={reg.totalCredits} bold dash={false} />
          </TD>
          <TD className={NUM}>
            <Amt cents={reg.closingCents} bold dash={false} />
          </TD>
        </TR>
      </TBody>
    </Table>
  );
}
