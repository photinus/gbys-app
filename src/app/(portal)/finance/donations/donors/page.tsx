import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { fmtDay } from "@/components/finance/gl/format";
import { guarded } from "@/components/finance/gl/guard";
import { Button, Card, EmptyState, Input, Label, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { listDonors, type DonorSort } from "@/lib/dal/finance-donations";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Donors" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <Check className="mx-auto h-4 w-4 text-emerald-800" role="img" aria-label={`${label} on file`} />
  ) : (
    <Minus className="mx-auto h-4 w-4 text-stone-400" role="img" aria-label={`No ${label.toLowerCase()}`} />
  );
}

export default async function DonorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/donations/donors");
  const sp = await searchParams;
  const q = one(sp.q);
  const sort = (["name", "lifetime", "recent"].includes(one(sp.sort) ?? "") ? one(sp.sort) : "name") as DonorSort;
  const { rows, year } = await guarded(() => listDonors(ctx, { q, sort }));
  return (
    <div className="space-y-5">
      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:flex sm:items-end">
          <div className="sm:w-72">
            <Label htmlFor="d-q">Search</Label>
            <Input id="d-q" name="q" defaultValue={q} placeholder="Name or email" />
          </div>
          <div className="sm:w-52">
            <Label htmlFor="d-sort">Sort by</Label>
            <Select id="d-sort" name="sort" defaultValue={sort}>
              <option value="name">Name</option>
              <option value="lifetime">Most given</option>
              <option value="recent">Most recent gift</option>
            </Select>
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Card>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No donors yet" description="Donors appear here when you record a gift." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Donor</TH>
                <TH className="text-right">Lifetime</TH>
                <TH className="text-right">{year}</TH>
                <TH>Last gift</TH>
                <TH className="text-center">Email</TH>
                <TH className="text-center">Address</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((d) => (
                <TR key={d.id} data-testid="donor-row">
                  <TD>
                    <Link href={`/finance/donations/donors/${d.id}`} className="font-semibold text-indigo-900 hover:underline">
                      {d.displayName}
                    </Link>
                    <span className="block text-xs text-stone-500">{d.giftCount} gift{d.giftCount === 1 ? "" : "s"}</span>
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(d.lifetimeCents)}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(d.thisYearCents)}</TD>
                  <TD className="whitespace-nowrap">{d.lastGiftDate ? fmtDay(d.lastGiftDate) : "—"}</TD>
                  <TD className="text-center">
                    <Flag ok={d.hasEmail} label="Email" />
                  </TD>
                  <TD className="text-center">
                    <Flag ok={d.hasAddress} label="Address" />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <p className="mt-3 text-xs text-stone-500">Totals count money gifts only; in-kind gifts are shown on each donor&apos;s page.</p>
      </Card>
    </div>
  );
}
