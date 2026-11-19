import Link from "next/link";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { TrialBalance } from "@/lib/finance/report-math";
import { Amt, NUM } from "./report-ui";

export function TrialBalanceTable({ t, registerHref }: { t: TrialBalance; registerHref?: (accountId: string) => string }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH className="text-left">Account</TH>
          <TH className="text-right">Debit</TH>
          <TH className="text-right">Credit</TH>
        </tr>
      </THead>
      <TBody>
        {t.rows.map((r) => (
          <TR key={r.accountId}>
            <TD className="py-2">
              <span className="text-stone-400 tabular-nums mr-2">{r.code}</span>
              {registerHref ? (
                <Link href={registerHref(r.accountId)} className="hover:underline">
                  {r.name}
                </Link>
              ) : (
                r.name
              )}
            </TD>
            <TD className={NUM}>
              <Amt cents={r.debitCents} />
            </TD>
            <TD className={NUM}>
              <Amt cents={r.creditCents} />
            </TD>
          </TR>
        ))}
        {t.rows.length === 0 ? (
          <TR>
            <TD colSpan={3} className="py-6 text-center text-stone-500">
              Nothing has been posted yet.
            </TD>
          </TR>
        ) : null}
        <TR className="border-t-2 border-charcoal bg-alabaster/60">
          <TD className="font-bold">Totals</TD>
          <TD className={NUM}>
            <Amt cents={t.totalDebits} bold dash={false} />
          </TD>
          <TD className={NUM}>
            <Amt cents={t.totalCredits} bold dash={false} />
          </TD>
        </TR>
      </TBody>
    </Table>
  );
}
