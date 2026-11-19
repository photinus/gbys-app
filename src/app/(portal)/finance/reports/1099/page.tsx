import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Check, X } from "lucide-react";
import { guard } from "@/components/finance/reports/page-helpers";
import { Amt, NUM, ReportFrame, fmtIso } from "@/components/finance/reports/report-ui";
import { Badge, Button, Card, EmptyState, Label, Select } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { get1099Report } from "@/lib/dal/finance-payables-reports";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "1099 vendors" };
export const dynamic = "force-dynamic";

export default async function Report1099Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/reports/1099");
  const sp = await searchParams;
  const yRaw = Number(Array.isArray(sp.year) ? sp.year[0] : sp.year);
  const r = await guard(get1099Report(ctx, { year: Number.isInteger(yRaw) ? yRaw : undefined }));
  return (
    <ReportFrame
      title="1099 vendors"
      subtitle="What we paid each 1099 vendor in a calendar year. Card and Stripe payments are left out because the card company reports those."
      period={`Calendar year ${r.year}`}
      csvHref={`/finance/reports/1099/csv?year=${r.year}`}
      controls={
        <Card className="print:hidden">
          <form method="get" action="/finance/reports/1099" className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="r1099-year">Year</Label>
              <Select id="r1099-year" name="year" defaultValue={String(r.year)}>
                {r.years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit">Update report</Button>
          </form>
          <p className="mt-3 text-xs text-stone-500">
            Vendors paid {`$${r.thresholdCents / 100}`} or more are flagged. The CSV shows the full tax ID only to finance admins, and each one shown is recorded in the audit log.
          </p>
        </Card>
      }
    >
      {r.missingW9Count > 0 ? (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            <strong>{r.missingW9Count} vendor{r.missingW9Count === 1 ? "" : "s"} over the limit {r.missingW9Count === 1 ? "has" : "have"} no W-9 on file.</strong> Ask them for one before filing.
          </p>
        </div>
      ) : null}
      <Card className="print:border-0 print:p-0 print:shadow-none">
        {r.rows.length === 0 ? (
          <EmptyState title={`No payments to 1099 vendors in ${r.year}`} description="Mark a vendor “Needs a 1099” on its contact page, then pay its bills." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm" data-testid="report-1099">
              <thead>
                <tr className="border-b border-line text-xs font-semibold uppercase tracking-wider text-stone-400">
                  <th className="py-2 pr-3 text-left">Vendor</th>
                  <th className="px-2 py-2 text-left">Tax ID</th>
                  <th className="px-2 py-2 text-left">W-9</th>
                  <th className={cn("px-2 py-2", NUM)}>Paid in {r.year}</th>
                  <th className={cn("px-2 py-2", NUM)}>By card or Stripe</th>
                  <th className="py-2 pl-2 text-left">Report?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {r.rows.map((v) => (
                  <tr key={v.contactId} data-testid="report-1099-row">
                    <td className="py-2.5 pr-3">
                      <Link href={`/finance/contacts/${v.contactId}`} className="font-semibold hover:underline">
                        {v.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-stone-600">
                      {v.taxIdLast4 ? `${(v.taxIdType ?? "").toUpperCase()} ••••${v.taxIdLast4}` : <span className="text-amber-800">Missing</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5">
                      {v.w9ReceivedOn ? (
                        <span className="inline-flex items-center gap-1 text-emerald-800">
                          <Check className="h-4 w-4" aria-hidden /> {fmtIso(v.w9ReceivedOn)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-stone-500">
                          <X className="h-4 w-4" aria-hidden /> None
                        </span>
                      )}
                    </td>
                    <td className={cn("px-2 py-2.5 font-semibold", NUM)}>
                      <Amt cents={v.totalCents} />
                    </td>
                    <td className={cn("px-2 py-2.5 text-stone-500", NUM)}>
                      <Amt cents={v.excludedCents} />
                    </td>
                    <td className="py-2.5 pl-2">{v.flagged ? <Badge tone="warning">1099 needed</Badge> : <span className="text-xs text-stone-400">Under ${r.thresholdCents / 100}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {r.quietVendors > 0 ? <p className="mt-4 text-xs text-stone-500">{r.quietVendors} other 1099 vendor{r.quietVendors === 1 ? "" : "s"} had no payments in {r.year}.</p> : null}
      </Card>
    </ReportFrame>
  );
}
