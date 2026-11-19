import type { Metadata } from "next";
import Link from "next/link";
import { guard, toReportQuery } from "@/components/finance/reports/page-helpers";
import { Amt, NUM, PeriodControls, ReportFrame, rangeText } from "@/components/finance/reports/report-ui";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireSession } from "@/lib/dal/context";
import { getDonorReport } from "@/lib/dal/finance-donations";
import { getReportMeta } from "@/lib/dal/finance-reports";
import { resolveRange } from "@/lib/finance/report-math";

export const metadata: Metadata = { title: "Donor report" };
export const dynamic = "force-dynamic";

export default async function DonorReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/reports/donors");
  const q = toReportQuery(await searchParams);
  const meta = await guard(getReportMeta(ctx));
  const range = resolveRange(q.from, q.to, { from: meta.fy.from, to: meta.fy.to });
  const r = await guard(getDonorReport(ctx, range));
  const csv = `/finance/reports/donors/export?from=${r.from}&to=${r.to}`;
  return (
    <ReportFrame
      title="Donor report"
      subtitle="Gifts by donor for the period, with deductible totals and whether each gift has been thanked in writing."
      period={rangeText(r.from, r.to)}
      csvHref={csv}
      controls={<PeriodControls basePath="/finance/reports/donors" meta={meta} mode="range" from={r.from} to={r.to} />}
    >
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <p className="mb-4 text-sm font-semibold text-stone-600 print:hidden">{rangeText(r.from, r.to)}</p>
        <Table>
          <THead>
            <tr>
              <TH className="text-left">Donor</TH>
              <TH className="text-right">Gifts</TH>
              <TH className="text-right">Money given</TH>
              <TH className="text-right">In-kind (value)</TH>
              <TH className="text-right">Deductible</TH>
              <TH className="text-right">Receipts sent</TH>
              <TH className="text-right">Still needed</TH>
            </tr>
          </THead>
          <TBody>
            {r.rows.length === 0 ? (
              <TR>
                <TD colSpan={7} className="py-6 text-center text-stone-500">
                  No gifts in this period.
                </TD>
              </TR>
            ) : (
              r.rows.map((d) => (
                <TR key={d.donorId ?? "anon"} data-testid="donor-report-row">
                  <TD className="py-2.5">
                    {d.donorId ? (
                      <Link href={`/finance/donations/donors/${d.donorId}`} className="font-semibold hover:underline">
                        {d.donorName}
                      </Link>
                    ) : (
                      <span className="text-stone-600">{d.donorName}</span>
                    )}
                  </TD>
                  <TD className={NUM}>{d.giftCount}</TD>
                  <TD className={NUM}>
                    <Amt cents={d.moneyCents} />
                  </TD>
                  <TD className={NUM}>
                    <Amt cents={d.inKindCents} />
                  </TD>
                  <TD className={NUM}>
                    <Amt cents={d.deductibleCents} />
                  </TD>
                  <TD className={NUM}>{d.donorId ? d.receiptsSent : "–"}</TD>
                  <TD className={NUM}>{d.donorId ? d.receiptsNeeded : "–"}</TD>
                </TR>
              ))
            )}
            <TR className="border-t border-line">
              <TD className="font-bold">Total</TD>
              <TD className={`${NUM} font-bold`}>{r.totals.giftCount}</TD>
              <TD className={NUM}>
                <Amt cents={r.totals.moneyCents} bold dash={false} />
              </TD>
              <TD className={NUM}>
                <Amt cents={r.totals.inKindCents} bold dash={false} />
              </TD>
              <TD className={NUM}>
                <Amt cents={r.totals.deductibleCents} bold dash={false} />
              </TD>
              <TD className={`${NUM} font-bold`}>{r.totals.receiptsSent}</TD>
              <TD className={`${NUM} font-bold`}>{r.totals.receiptsNeeded}</TD>
            </TR>
          </TBody>
        </Table>
        <p className="mt-4 text-xs text-stone-500">
          Anonymous gifts with no donor on record are grouped on one line and can&apos;t be receipted. Deductible = money given minus the value of anything the donor received in return; in-kind gifts are valued for our books only and are not deductible amounts here.{" "}
          <Link href="/finance/donations?receipt=needed" className="font-semibold text-indigo-900 hover:underline">
            See gifts that need a receipt
          </Link>
          .
        </p>
      </Card>
    </ReportFrame>
  );
}
