import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  LEDGER_KINDS,
  LEDGER_KIND_LABELS,
  type LedgerFilter,
  type LedgerKind,
  type LedgerPage,
} from "@/lib/dal/payments-ledger";
import { formatCents, formatDateTime } from "@/lib/format";

const KIND_TONE: Record<LedgerKind, BadgeTone> = {
  charge: "success",
  offline_payment: "success",
  refund: "warning",
  offline_void: "neutral",
  dispute_opened: "danger",
  dispute_closed: "info",
};

function qs(params: Record<string, string | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

function Stat({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-white p-4" data-testid={testId}>
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className="mt-1 text-xl font-bold tracking-tight text-charcoal">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-stone-400">{hint}</div> : null}
    </div>
  );
}

/**
 * Shared ledger body for the program page and the board-wide page: totals for
 * the filtered range, a GET filter form, the page of events and an "Older" link.
 */
export function LedgerView({
  page,
  filter,
  basePath,
  exportPath,
  programs,
  showProgram,
  cursor,
}: {
  page: LedgerPage;
  filter: LedgerFilter;
  basePath: string;
  exportPath: string;
  /** Board-wide page only: program filter options. */
  programs?: { id: string; name: string }[];
  showProgram: boolean;
  cursor?: string | null;
}) {
  const { totals, rows, nextCursor } = page;
  const keep = { program: filter.programId, from: filter.from, to: filter.to, kind: filter.kind };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat testId="total-gross" label="Gross collected" value={formatCents(totals.grossCents)} hint="Card + offline" />
        <Stat testId="total-refunds" label="Refunded" value={formatCents(totals.refundedCents + totals.voidedCents)} hint={totals.voidedCents ? `incl. ${formatCents(totals.voidedCents)} voided` : undefined} />
        <Stat testId="total-net" label="Net" value={formatCents(totals.netCents)} />
        <Stat testId="total-fees" label="Platform fees" value={formatCents(totals.platformFeesCents)} hint="Partner programs" />
        <Stat testId="total-disputes" label="Disputes" value={formatCents(totals.disputedCents)} hint={`${totals.disputeCount} opened`} />
      </div>

      <Card>
        <form method="get" className="flex flex-col gap-3 pb-5 sm:flex-row sm:flex-wrap sm:items-end" data-testid="ledger-filters">
          {programs ? (
            <label className="block min-w-0 sm:w-56">
              <span className="mb-1 block text-xs font-semibold text-stone-500">Program</span>
              <Select name="program" defaultValue={filter.programId ?? ""}>
                <option value="">All programs</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <label className="block sm:w-40">
            <span className="mb-1 block text-xs font-semibold text-stone-500">From</span>
            <Input type="date" name="from" defaultValue={filter.from ?? ""} />
          </label>
          <label className="block sm:w-40">
            <span className="mb-1 block text-xs font-semibold text-stone-500">To</span>
            <Input type="date" name="to" defaultValue={filter.to ?? ""} />
          </label>
          <label className="block sm:w-48">
            <span className="mb-1 block text-xs font-semibold text-stone-500">Event</span>
            <Select name="kind" defaultValue={filter.kind ?? ""}>
              <option value="">All events</option>
              {LEDGER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LEDGER_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm">
              Apply
            </Button>
            <Link href={basePath} className={buttonStyles({ size: "sm", variant: "ghost" })}>
              Reset
            </Link>
            <a href={`${exportPath}${qs(keep)}`} data-testid="ledger-export" className={buttonStyles({ size: "sm", variant: "secondary" })}>
              <Download className="h-4 w-4" />
              Export CSV
            </a>
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState title="No payment activity" description="Nothing in the ledger matches these filters." />
        ) : (
          <Table className="min-w-[860px]">
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Event</TH>
                <TH>Athlete</TH>
                {showProgram ? <TH>Program</TH> : null}
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Fee</TH>
                <TH>Details</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} data-testid="ledger-row" className="align-top">
                  <TD className="whitespace-nowrap text-stone-600">{formatDateTime(r.occurredAt)}</TD>
                  <TD>
                    <Badge tone={KIND_TONE[r.kind]}>{LEDGER_KIND_LABELS[r.kind]}</Badge>
                  </TD>
                  <TD>
                    <div className="font-medium text-charcoal">{r.athleteName}</div>
                    <div className="text-xs text-stone-500">{r.seasonName}</div>
                  </TD>
                  {showProgram ? <TD className="text-stone-600">{r.programName ?? ""}</TD> : null}
                  <TD className="whitespace-nowrap text-right font-semibold tabular-nums">
                    {r.kind === "refund" || r.kind === "offline_void" ? "-" : ""}
                    {formatCents(r.amountCents)}
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums text-stone-600">
                    {r.applicationFeeCents ? formatCents(r.applicationFeeCents) : ""}
                  </TD>
                  <TD className="max-w-[260px] text-xs text-stone-500">
                    {r.method && r.method !== "stripe" ? <span className="capitalize">{r.method}</span> : null}
                    {r.note ? <div className="break-words">{r.note}</div> : null}
                    {r.stripeObjectId ? <div className="break-all font-mono text-[11px] text-stone-400">{r.stripeObjectId}</div> : null}
                    <div className="text-stone-400">{r.recordedByName ?? (r.stripeObjectId ? "Stripe" : "")}</div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {nextCursor || cursor ? (
          <div className="flex items-center justify-between pt-4 text-xs">
            <span className="text-stone-400">{totals.eventCount} events in range</span>
            {nextCursor ? (
              <Link href={`${basePath}${qs({ ...keep, cursor: nextCursor })}`} data-testid="ledger-older" className={buttonStyles({ size: "sm", variant: "secondary" })}>
                Older events
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="pt-4 text-xs text-stone-400">{totals.eventCount} events in range</div>
        )}
      </Card>
    </div>
  );
}
