"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { HoursEntryRow } from "@/lib/dal/volunteer-hours";
import { formatDate, formatHours } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/volunteer-categories";
import { withdrawMyHoursAction } from "@/app/(portal)/volunteer/hours/actions";
import { VerificationBadge } from "./verification-badge";

function WithdrawButton({ id }: { id: string }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    if (busy) return;
    if (!window.confirm("Withdraw this entry? It will be removed from review.")) return;
    setBusy(true);
    const res = await withdrawMyHoursAction(id);
    setBusy(false);
    if (res.ok) {
      toast.success("Entry withdrawn");
      router.refresh();
    } else {
      toast.error("Could not withdraw", res.error);
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={busy}>
      {busy ? "Withdrawing..." : "Withdraw"}
    </Button>
  );
}

function Detail({ r }: { r: HoursEntryRow }) {
  return (
    <>
      <div className="text-charcoal">{r.description || "-"}</div>
      {r.enteredByOther && r.verificationMethod === "admin_approved" ? (
        <div className="text-xs text-stone-500">Entered by {r.approvedByName ?? "the board"}</div>
      ) : null}
    </>
  );
}

export function MyLedger({ entries, rejected }: { entries: HoursEntryRow[]; rejected: HoursEntryRow[] }) {
  if (entries.length === 0 && rejected.length === 0) {
    return (
      <EmptyState
        title="No hours logged yet"
        description="Log your first entry above, or check in at a shift."
      />
    );
  }
  return (
    <div className="space-y-6">
      {entries.length > 0 ? (
        <>
          {/* Phone: stacked cards */}
          <ul className="space-y-3 sm:hidden" data-testid="ledger-cards">
            {entries.map((r) => (
              <li key={r.id} className="rounded-2xl border border-line bg-alabaster/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-charcoal">{formatHours(r.durationMinutes)}</div>
                    <div className="text-xs text-stone-500">{formatDate(r.activityDate)}</div>
                  </div>
                  <VerificationBadge method={r.verificationMethod} />
                </div>
                <div className="mt-2 text-xs text-stone-500">
                  {CATEGORY_LABELS[r.category]} · {r.programName ?? "Organization"}
                </div>
                {r.roleName ? <div className="mt-1 text-xs font-semibold text-indigo-800">Role: {r.roleName}</div> : null}
                <div className="mt-1 text-sm">
                  <Detail r={r} />
                </div>
                {r.verificationMethod === "self_reported" ? (
                  <div className="mt-3">
                    <WithdrawButton id={r.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {/* Tablet and up: table */}
          <div className="hidden sm:block" data-testid="ledger-table">
            <Table className="min-w-[720px]">
              <THead>
                <tr>
                  <TH className="pl-2">Date</TH>
                  <TH>Hours</TH>
                  <TH>Program / category</TH>
                  <TH>Description</TH>
                  <TH>Status</TH>
                  <TH className="pr-2 text-right"> </TH>
                </tr>
              </THead>
              <TBody>
                {entries.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap pl-2 text-stone-600">{formatDate(r.activityDate)}</TD>
                    <TD className="whitespace-nowrap font-semibold text-charcoal">
                      {formatHours(r.durationMinutes)}
                    </TD>
                    <TD>
                      <div className="text-charcoal">{r.programName ?? "Organization"}</div>
                      <div className="text-xs text-stone-500">{CATEGORY_LABELS[r.category]}</div>
                      {r.roleName ? <div className="text-xs font-semibold text-indigo-800">Role: {r.roleName}</div> : null}
                    </TD>
                    <TD className="max-w-xs">
                      <Detail r={r} />
                    </TD>
                    <TD>
                      <VerificationBadge method={r.verificationMethod} />
                    </TD>
                    <TD className="pr-2 text-right">
                      {r.verificationMethod === "self_reported" ? <WithdrawButton id={r.id} /> : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </>
      ) : null}

      {rejected.length > 0 ? (
        <section aria-label="Rejected entries" data-testid="rejected-entries">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-stone-400">
            Rejected or removed
          </h3>
          <ul className="space-y-2">
            {rejected.map((r) => (
              <li key={r.id} className="rounded-2xl border border-coral/50 bg-coral/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-charcoal">
                    {formatHours(r.durationMinutes)} · {formatDate(r.activityDate)} ·{" "}
                    {CATEGORY_LABELS[r.category]}
                  </div>
                  <Badge tone="danger">{r.verificationMethod === "self_reported" ? "Rejected" : "Removed"}</Badge>
                </div>
                <p className="mt-1 text-sm text-rose-900">
                  Reason: {r.deletionReason ?? "No reason given"}
                  {r.deletedByName ? ` (${r.deletedByName})` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
