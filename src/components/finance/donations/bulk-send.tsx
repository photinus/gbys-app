"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendAllAnnualAction, sendBulkReceiptsAction } from "@/app/(portal)/finance/donations/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Modal, useToast } from "@/components/ui";
import type { BulkSendResult } from "@/lib/dal/finance-receipts";

function ResultBox({ r, noun }: { r: BulkSendResult; noun: string }) {
  return (
    <div className="space-y-2 rounded-2xl bg-sage/25 px-4 py-3 text-sm" data-testid="bulk-result">
      <p className="font-semibold text-emerald-950">
        Sent {r.sent} {noun}
        {r.sent === 1 ? "" : "s"}.
      </p>
      {r.skippedNoEmail ? <p className="text-xs text-stone-700">{r.skippedNoEmail} skipped because there is no email address. Print or mail those instead.</p> : null}
      {r.more ? <p className="text-xs text-stone-700">There are more to send. Run it again to send the next batch.</p> : null}
      {r.failed.length ? (
        <div className="rounded-xl bg-coral/25 px-3 py-2 text-xs text-rose-950">
          <p className="font-semibold">{r.failed.length} could not be sent (nothing was recorded for these):</p>
          <ul className="mt-1 list-disc pl-5">
            {r.failed.slice(0, 10).map((f) => (
              <li key={f.giftId}>
                {f.donorName ?? "Unknown"}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Bulk-send receipts for a date range (preview counts are shown by the page). */
export function BulkReceiptSend({ from, to, emailable }: { from: string; to: string; emailable: number }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(sendBulkReceiptsAction);
  const done = state?.ok ? state.data : null;
  return (
    <div className="space-y-3">
      <Button onClick={() => setOpen(true)} disabled={emailable === 0 || !!done} data-testid="bulk-open">
        <Send className="h-4 w-4" /> Email {emailable} receipt{emailable === 1 ? "" : "s"}
      </Button>
      {done ? <ResultBox r={done} noun="receipt" /> : null}
      <Modal
        open={open && !done}
        onClose={() => setOpen(false)}
        title={`Email ${emailable} receipt${emailable === 1 ? "" : "s"}?`}
        description="Each donor gets one email per gift. Every send is recorded; nothing is recorded if an email fails."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="bulk-form"
              disabled={pending}
              data-testid="bulk-confirm"
            >
              {pending ? "Sending..." : "Send now"}
            </Button>
          </>
        }
      >
        <form
          id="bulk-form"
          onSubmit={(e) => {
            onSubmit(e);
          }}
          className="space-y-3 text-sm"
        >
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <p className="text-stone-600">
            Gifts dated {from} to {to} that have no receipt yet, and whose donor has an email address.
          </p>
          <FormError state={state} />
        </form>
      </Modal>
      {done ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            toast.success("Refreshed");
            router.refresh();
          }}
        >
          Refresh counts
        </Button>
      ) : null}
    </div>
  );
}

/** Email every yearly statement that still needs sending. */
export function AnnualBulkSend({ year, emailable }: { year: number; emailable: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<BulkSendResult | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    const r = await sendAllAnnualAction(year);
    setBusy(false);
    if (r.ok) {
      setRes(r.data);
      setOpen(false);
      router.refresh();
    } else setErr(r.error);
  }
  return (
    <div className="space-y-3">
      <Button onClick={() => setOpen(true)} disabled={emailable === 0} data-testid="annual-bulk-open">
        <Send className="h-4 w-4" /> Email {emailable} statement{emailable === 1 ? "" : "s"}
      </Button>
      {res ? <ResultBox r={res} noun="statement" /> : null}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Email ${emailable} ${year} statement${emailable === 1 ? "" : "s"}?`}
        description="Each donor gets one email listing all of their gifts for the year."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={run} disabled={busy} data-testid="annual-bulk-confirm">
              {busy ? "Sending..." : "Send now"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-stone-600">Only donors with an email address who haven&apos;t received this year&apos;s statement (or whose gifts changed since) are included.</p>
        {err ? <p className="mt-3 text-xs font-medium text-rose-800">{err}</p> : null}
      </Modal>
    </div>
  );
}
