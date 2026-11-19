import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { VoidEntryButton } from "@/components/finance/gl/void-entry-button";
import { Badge, Card, CardHeader, TBody, TD, TH, THead, TR, Table, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { getJournalEntry } from "@/lib/dal/finance-journal";
import { formatDateTime } from "@/lib/format";
import { ENTRY_SOURCE_LABELS } from "@/lib/validation/finance-gl";

export const metadata: Metadata = { title: "Journal entry" };
export const dynamic = "force-dynamic";

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/journal/${id}`);
  const { entry, canEdit } = await guarded(async () => ({
    entry: await getJournalEntry(ctx, id),
    canEdit: canEditBooks(await getFinanceAccess(ctx)),
  }));
  if (!entry) notFound();
  const voided = !!entry.voidedAt;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/journal" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Journal</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Entry #{entry.entryNumber}{" "}
              {voided ? <Badge tone="neutral" className="align-middle">Voided</Badge> : <Badge tone="success" className="align-middle">Posted</Badge>}
            </h1>
            <p className="mt-1 break-words text-sm text-stone-500">{entry.memo}</p>
          </div>
          {canEdit && !voided ? (
            <div className="flex flex-wrap gap-2">
              {entry.editable ? (
                <Link href={`/finance/journal/${entry.id}/edit`} className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="edit-entry">
                  Edit entry
                </Link>
              ) : null}
              <VoidEntryButton entryId={entry.id} entryNumber={entry.entryNumber} hasBankLink={entry.bankTransactions.length > 0} />
            </div>
          ) : null}
        </div>
      </div>

      {voided ? (
        <div className="rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-700" data-testid="void-banner">
          <strong>Voided</strong> {entry.voidedAt ? formatDateTime(entry.voidedAt) : ""}
          {entry.voidedByName ? ` by ${entry.voidedByName}` : ""}. Reason: {entry.voidReason}
          {entry.replacedBy ? (
            <>
              {" "}
              Replaced by{" "}
              <Link href={`/finance/journal/${entry.replacedBy.id}`} className="font-semibold underline">
                entry #{entry.replacedBy.entryNumber}
              </Link>
              .
            </>
          ) : null}
        </div>
      ) : null}
      {entry.replaces ? (
        <div className="rounded-2xl bg-periwinkle/20 px-4 py-3 text-sm text-indigo-950">
          This entry corrects{" "}
          <Link href={`/finance/journal/${entry.replaces.id}`} className="font-semibold underline">
            entry #{entry.replaces.entryNumber}
          </Link>
          .
        </div>
      ) : null}
      {!voided && canEdit && !entry.editable ? (
        <p className="rounded-2xl bg-alabaster px-4 py-3 text-xs text-stone-600">
          This entry was created automatically ({ENTRY_SOURCE_LABELS[entry.source] ?? entry.source}). To change it, fix it where it came from. You can
          void it if it&apos;s wrong.
        </p>
      ) : null}

      <Card>
        <CardHeader title="Details" />
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold text-stone-400">Date</dt>
            <dd className="text-charcoal">{fmtDay(entry.entryDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">Source</dt>
            <dd className="text-charcoal">{ENTRY_SOURCE_LABELS[entry.source] ?? entry.source}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">Entered</dt>
            <dd className="text-charcoal">
              {formatDateTime(entry.createdAt)}
              <span className="block text-xs text-stone-500">{entry.createdByName ? `by ${entry.createdByName}` : "automatically"}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">Total</dt>
            <dd className="tabular-nums text-charcoal">{money(entry.totalCents)}</dd>
          </div>
        </dl>
        {entry.links.length || entry.bankTransactions.length ? (
          <div className="mt-4 space-y-2 border-t border-line-soft pt-4 text-sm">
            {entry.bankTransactions.map((t) => (
              <p key={t.id} className="text-stone-600">
                Bank transaction: {fmtDay(t.postedDate)} · {t.description} · {money(Math.abs(t.amountCents))} {t.amountCents < 0 ? "out" : "in"} ({t.accountName})
              </p>
            ))}
            <div className="flex flex-wrap gap-3">
              {entry.links.map((l) => (
                <Link key={l.href + l.label} href={l.href} className="text-xs font-semibold text-indigo-700 hover:underline">
                  {l.label} →
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Lines" description="Debits and credits are always equal." />
        <Table>
          <THead>
            <tr>
              <TH>Account</TH>
              <TH>Fund</TH>
              <TH>Program</TH>
              <TH>Note</TH>
              <TH className="text-right">Debit</TH>
              <TH className="text-right">Credit</TH>
            </tr>
          </THead>
          <TBody>
            {entry.lines.map((l) => (
              <TR key={l.lineNo} data-testid="entry-line">
                <TD>
                  <span className="text-stone-400">{l.accountCode}</span> {l.accountName}
                </TD>
                <TD className="text-xs">{l.fundName}</TD>
                <TD className="text-xs">{l.programName ?? <span className="text-stone-400">Whole organization</span>}</TD>
                <TD className="max-w-[220px] text-xs text-stone-500">{l.description}</TD>
                <TD className="text-right tabular-nums">{l.debitCents ? money(l.debitCents) : ""}</TD>
                <TD className="text-right tabular-nums">{l.creditCents ? money(l.creditCents) : ""}</TD>
              </TR>
            ))}
            <TR>
              <TD className="font-semibold" colSpan={4}>Total</TD>
              <TD className="text-right font-semibold tabular-nums">{money(entry.lines.reduce((s, l) => s + l.debitCents, 0))}</TD>
              <TD className="text-right font-semibold tabular-nums">{money(entry.lines.reduce((s, l) => s + l.creditCents, 0))}</TD>
            </TR>
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
