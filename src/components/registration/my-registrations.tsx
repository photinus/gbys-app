"use client";

import { FileSignature } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { withdrawRegistrationAction } from "@/app/(portal)/registrations/actions";
import { Badge, Button, buttonStyles, Card, EmptyState, Modal, useToast, type BadgeTone } from "@/components/ui";
import type { MyRegistration } from "@/lib/dal/registrations";
import { formatCents, formatDate, formatDob } from "@/lib/format";
import { SignedWaiverSheet } from "./signed-waiver-sheet";

const PAYMENT: Record<MyRegistration["paymentStatus"], { label: string; tone: BadgeTone }> = {
  unpaid: { label: "Payment due", tone: "warning" },
  pending: { label: "Payment pending", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  waived_scholarship: { label: "Scholarship", tone: "success" },
  refunded: { label: "Refunded", tone: "neutral" },
};

export function MyRegistrations({ registrations }: { registrations: MyRegistration[] }) {
  const toast = useToast();
  const [waiverId, setWaiverId] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<MyRegistration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmWithdraw() {
    if (!withdrawing) return;
    const id = withdrawing.id;
    setError(null);
    startTransition(async () => {
      const res = await withdrawRegistrationAction(id);
      if (res.ok) {
        setWithdrawing(null);
        toast.success("Registration withdrawn");
      } else setError(res.error);
    });
  }

  if (registrations.length === 0) {
    return (
      <EmptyState
        title="No registrations yet"
        description="When you register an athlete for a program, it shows up here."
        action={
          <Link href="/" className={buttonStyles({ size: "sm" })}>
            See open registrations
          </Link>
        }
      />
    );
  }

  return (
    <>
      <ul className="space-y-4">
        {registrations.map((r) => {
          const pay = PAYMENT[r.paymentStatus];
          const cancelled = r.status === "cancelled";
          return (
            <li key={r.id}>
              <Card className={cancelled ? "opacity-80" : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-bold text-charcoal">{r.athleteName}</h2>
                    <p className="break-words text-sm text-stone-600">
                      {r.programName} - {r.seasonName}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {cancelled ? <Badge tone="danger">Cancelled</Badge> : <Badge tone="success">Registered</Badge>}
                    {!cancelled ? <Badge tone={pay.tone}>{pay.label}</Badge> : null}
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-stone-400">Fee</dt>
                    <dd className="mt-0.5 font-semibold text-charcoal">{r.feeCents === 0 ? "Free" : formatCents(r.feeCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-400">Registered</dt>
                    <dd className="mt-0.5 font-semibold text-charcoal">{formatDate(r.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-400">Season starts</dt>
                    <dd className="mt-0.5 font-semibold text-charcoal">{r.seasonStartsOn ? formatDob(r.seasonStartsOn) : "TBD"}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-stone-400">Waiver</dt>
                    <dd className="mt-0.5 break-words font-semibold text-charcoal">
                      {r.waiver ? `${r.waiver.version}, signed ${formatDate(r.waiver.signedAt)}` : "None on file"}
                    </dd>
                  </div>
                </dl>
                {cancelled ? (
                  <p className="mt-3 text-xs text-stone-500">
                    Cancelled{r.cancelledAt ? ` ${formatDate(r.cancelledAt)}` : ""}
                    {r.cancellationReason ? `: ${r.cancellationReason}` : ""}
                  </p>
                ) : r.paymentStatus === "unpaid" ? (
                  <p className="mt-3 text-xs text-stone-500">
                    Pay your program by cash or check; a coordinator will record it.
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {r.waiver ? (
                    <Button size="sm" variant="secondary" onClick={() => setWaiverId(r.id)}>
                      <FileSignature className="h-4 w-4" aria-hidden /> View signed waiver
                    </Button>
                  ) : null}
                  {r.canWithdraw ? (
                    <Button size="sm" variant="danger" onClick={() => { setError(null); setWithdrawing(r); }}>
                      Withdraw
                    </Button>
                  ) : r.withdrawBlockedReason ? (
                    <span className="text-xs text-stone-400">{r.withdrawBlockedReason}</span>
                  ) : null}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <SignedWaiverSheet registrationId={waiverId} onClose={() => setWaiverId(null)} />

      <Modal
        open={withdrawing !== null}
        onClose={() => (pending ? undefined : setWithdrawing(null))}
        title="Withdraw registration?"
        description={withdrawing ? `${withdrawing.athleteName} - ${withdrawing.programName}, ${withdrawing.seasonName}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawing(null)} disabled={pending}>
              Keep registration
            </Button>
            <Button variant="danger" onClick={confirmWithdraw} disabled={pending}>
              {pending ? "Withdrawing..." : "Withdraw"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-stone-600">
          This cancels the registration. You can register again later while registration is open. The signed waiver
          stays on record.
        </p>
        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
            {error}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
