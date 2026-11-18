"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { RosterRow } from "@/lib/dal/rosters";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/validation/household";
import { OFFLINE_METHOD_LABELS, OFFLINE_METHODS, type RosterFilter } from "@/lib/validation/rosters";
import { cn } from "@/lib/utils";
import {
  cancelRegistrationAction,
  recordPaymentAction,
  voidPaymentAction,
} from "@/app/(portal)/programs/[slug]/seasons/[seasonId]/registrations/actions";
import { PaymentBadge } from "./payment-badge";

const FILTERS: { id: RosterFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unpaid", label: "Unpaid" },
  { id: "paid", label: "Paid" },
  { id: "cancelled", label: "Cancelled" },
];

type Dialog = { kind: "pay" | "cancel" | "void"; row: RosterRow } | null;

export function RosterTable({
  rows,
  filter,
  basePath,
  canManage,
  isBoard,
}: {
  rows: RosterRow[];
  filter: RosterFilter;
  basePath: string;
  canManage: boolean;
  isBoard: boolean;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  return (
    <>
      <div className="flex flex-wrap gap-2 pb-4" role="tablist" aria-label="Filter registrations">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            href={f.id === "all" ? basePath : `${basePath}?filter=${f.id}`}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              filter === f.id ? "bg-charcoal text-white" : "bg-alabaster text-stone-600 hover:text-charcoal"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No registrations here" description="Nothing matches this filter yet." />
      ) : (
        <Table className="min-w-[980px]">
          <THead>
            <tr>
              <TH>Athlete</TH>
              <TH>Guardian</TH>
              <TH>Answers</TH>
              <TH>Payment</TH>
              <TH>Waiver</TH>
              {canManage ? <TH className="text-right">Actions</TH> : null}
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.registrationId} className="align-top">
                <TD>
                  <div className="font-semibold text-charcoal">{r.athleteName}</div>
                  <div className="text-xs text-stone-500">{r.age !== null ? `Age ${r.age}` : ""}</div>
                  {r.cancelledAt ? (
                    <div className="mt-1">
                      <Badge tone="danger">Cancelled {formatDate(r.cancelledAt)}</Badge>
                      {r.cancellationReason ? (
                        <div className="mt-1 text-xs text-stone-500">{r.cancellationReason}</div>
                      ) : null}
                    </div>
                  ) : null}
                </TD>
                <TD>
                  <div className="text-charcoal">{r.guardianName}</div>
                  <a href={`mailto:${r.guardianEmail}`} className="block text-xs text-stone-500 hover:underline">
                    {r.guardianEmail}
                  </a>
                  {r.guardianPhone ? (
                    <a href={`tel:${r.guardianPhone}`} className="block text-xs text-stone-500 hover:underline">
                      {formatPhone(r.guardianPhone)}
                    </a>
                  ) : null}
                </TD>
                <TD className="max-w-[240px]">
                  {r.answers.length === 0 ? (
                    <span className="text-xs text-stone-400">None</span>
                  ) : (
                    <dl className="space-y-0.5 text-xs">
                      {r.answers.map((a) => (
                        <div key={a.label}>
                          <dt className="inline text-stone-500">{a.label}: </dt>
                          <dd className="inline text-charcoal">{a.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </TD>
                <TD>
                  <PaymentBadge status={r.paymentStatus} />
                  <div className="mt-1 text-xs text-stone-500">
                    {r.paymentMethod ? `${OFFLINE_METHOD_LABELS[r.paymentMethod as keyof typeof OFFLINE_METHOD_LABELS] ?? "Online"}` : ""}
                    {r.amountPaidCents !== null && r.paymentStatus === "paid"
                      ? ` · ${formatCents(r.amountPaidCents)}`
                      : ` · fee ${formatCents(r.feeCents)}`}
                  </div>
                  {r.reference ? <div className="text-xs text-stone-500">{r.reference}</div> : null}
                  {r.paidAt ? <div className="text-xs text-stone-400">{formatDate(r.paidAt)}</div> : null}
                </TD>
                <TD>
                  {r.waiver ? (
                    <>
                      <Badge tone="success">Signed {r.waiver.version}</Badge>
                      <div className="mt-1 text-xs text-stone-400">{formatDateTime(r.waiver.signedAt)}</div>
                    </>
                  ) : (
                    <Badge tone="warning">Not on file</Badge>
                  )}
                </TD>
                {canManage ? (
                  <TD className="text-right">
                    {r.cancelledAt ? null : (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {r.paymentStatus === "unpaid" ? (
                          <Button size="sm" onClick={() => setDialog({ kind: "pay", row: r })}>
                            Record payment
                          </Button>
                        ) : null}
                        {isBoard &&
                        r.paymentMethod &&
                        r.paymentMethod !== "stripe" &&
                        (r.paymentStatus === "paid" || r.paymentStatus === "waived_scholarship") ? (
                          <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "void", row: r })}>
                            Void payment
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "cancel", row: r })}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={dialog?.kind === "pay"}
        onClose={close}
        title="Record payment"
        description={dialog ? `${dialog.row.athleteName} · fee ${formatCents(dialog.row.feeCents)}` : undefined}
      >
        {dialog?.kind === "pay" ? <PayForm row={dialog.row} basePath={basePath} onDone={close} /> : null}
      </Modal>
      <Modal
        open={dialog?.kind === "cancel"}
        onClose={close}
        title="Cancel registration"
        description={dialog?.row.athleteName}
      >
        {dialog?.kind === "cancel" ? <CancelForm row={dialog.row} basePath={basePath} onDone={close} /> : null}
      </Modal>
      <Modal
        open={dialog?.kind === "void"}
        onClose={close}
        title="Void payment"
        description={dialog?.row.athleteName}
      >
        {dialog?.kind === "void" ? <VoidForm row={dialog.row} basePath={basePath} onDone={close} /> : null}
      </Modal>
    </>
  );
}

function PayForm({ row, basePath, onDone }: { row: RosterRow; basePath: string; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(recordPaymentAction);
  const [method, setMethod] = useState<string>("cash");

  useEffect(() => {
    if (state?.ok) {
      toast.success("Payment recorded");
      router.refresh();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="registrationId" value={row.registrationId} />
      <input type="hidden" name="path" value={basePath} />
      <Field label="Method">
        <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={pending}>
          {OFFLINE_METHODS.map((m) => (
            <option key={m} value={m}>
              {OFFLINE_METHOD_LABELS[m]}
            </option>
          ))}
        </Select>
      </Field>
      {method !== "scholarship" ? (
        <Field label="Amount received ($)" hint={`Must equal the fee of ${formatCents(row.feeCents)}.`}>
          <Input
            name="amount"
            inputMode="decimal"
            defaultValue={(row.feeCents / 100).toFixed(2)}
            disabled={pending}
            required
          />
        </Field>
      ) : null}
      <Field
        label={method === "check" ? "Check number" : method === "scholarship" ? "Scholarship note" : "Note (optional)"}
      >
        <Input name="reference" maxLength={200} disabled={pending} required={method !== "cash"} />
      </Field>
      <FormError state={state} />
      <div className="flex items-center justify-end gap-2.5">
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Close
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Record payment"}
        </Button>
      </div>
    </form>
  );
}

function CancelForm({ row, basePath, onDone }: { row: RosterRow; basePath: string; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(cancelRegistrationAction);

  useEffect(() => {
    if (state?.ok) {
      if (state.data.warning) toast.error("Registration cancelled", state.data.warning);
      else toast.success("Registration cancelled");
      router.refresh();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const paid = row.paymentStatus !== "unpaid";
  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="registrationId" value={row.registrationId} />
      <input type="hidden" name="path" value={basePath} />
      {paid ? (
        <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs font-medium text-amber-950">
          This registration is marked paid. Record a refund outside the app (Sprint 3b adds Stripe refunds).
        </p>
      ) : null}
      <Field label="Reason">
        <Textarea name="reason" rows={3} maxLength={500} required disabled={pending} />
      </Field>
      <FormError state={state} />
      <div className="flex items-center justify-end gap-2.5">
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Keep registration
        </Button>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Cancelling..." : "Cancel registration"}
        </Button>
      </div>
    </form>
  );
}

function VoidForm({ row, basePath, onDone }: { row: RosterRow; basePath: string; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(voidPaymentAction);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Payment voided", "The registration is unpaid again.");
      router.refresh();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-busy={pending}>
      <input type="hidden" name="registrationId" value={row.registrationId} />
      <input type="hidden" name="path" value={basePath} />
      <p className="text-xs text-stone-500">
        Returns this registration to unpaid. The previous payment details are kept in the audit log.
      </p>
      <Field label="Reason">
        <Textarea name="reason" rows={3} maxLength={500} required disabled={pending} />
      </Field>
      <FormError state={state} />
      <div className="flex items-center justify-end gap-2.5">
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Close
        </Button>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Voiding..." : "Void payment"}
        </Button>
      </div>
    </form>
  );
}
