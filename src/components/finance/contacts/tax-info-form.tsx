"use client";

import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { revealTaxIdAction, setTaxInfoAction } from "@/app/(portal)/finance/contacts/actions";
import { useRunner } from "@/components/finance/banking/use-runner";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Modal, Select, useToast } from "@/components/ui";

/** SSN / EIN and W-9 received date. The full number is never sent back to the page. */
export function TaxInfoForm({
  contactId,
  taxIdType,
  taxIdLast4,
  w9ReceivedOn,
  canEdit,
  canReveal,
  encryptionReady,
}: {
  contactId: string;
  taxIdType: string | null;
  taxIdLast4: string | null;
  w9ReceivedOn: string | null;
  canEdit: boolean;
  canReveal: boolean;
  encryptionReady: boolean;
}) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useActionForm(setTaxInfoAction);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealed, setRevealed] = useState<string | null | undefined>(undefined);
  const { run, pending: revealing, error, setError } = useRunner({ inline: true });

  useEffect(() => {
    if (state?.ok) {
      toast.success("Tax info saved");
      formRef.current?.reset();
    }
  }, [state, toast]);

  const closeReveal = () => {
    setRevealOpen(false);
    setRevealed(undefined);
    setError(null);
  };
  const label = taxIdType === "ein" ? "EIN" : "SSN";
  const fmt = (v: string) => (taxIdType === "ein" ? `${v.slice(0, 2)}-${v.slice(2)}` : `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}`);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="tax-summary">
          {taxIdLast4 ? (
            <>
              {label} on file, ending in <strong className="tabular-nums">{taxIdLast4}</strong>
            </>
          ) : (
            <span className="text-stone-500">No tax ID on file.</span>
          )}
          <span className="ml-2 text-stone-500">{w9ReceivedOn ? `W-9 received ${w9ReceivedOn}` : "W-9 not received"}</span>
        </p>
        {canReveal && taxIdLast4 ? (
          <Button variant="secondary" size="sm" onClick={() => setRevealOpen(true)} data-testid="reveal-tax-id">
            <Eye className="h-4 w-4" /> Show full number
          </Button>
        ) : null}
      </div>

      {canEdit ? (
        encryptionReady ? (
          <form ref={formRef} onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-alabaster p-4">
            <input type="hidden" name="contactId" value={contactId} />
            <p className="text-xs text-stone-500">Entering a new number replaces the old one. It is stored encrypted and only the last 4 digits are shown.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Type">
                <Select name="taxIdType" defaultValue={taxIdType ?? "ssn"} aria-label="Tax ID type">
                  <option value="ssn">Social Security number</option>
                  <option value="ein">EIN (business)</option>
                </Select>
              </Field>
              <Field label="Number (9 digits)">
                <Input name="taxId" required inputMode="numeric" autoComplete="off" placeholder="9 digits" data-testid="tax-id-input" />
              </Field>
              <Field label="W-9 received on">
                <Input type="date" name="w9ReceivedOn" defaultValue={w9ReceivedOn ?? ""} />
              </Field>
            </div>
            <FormError state={state} />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={pending} data-testid="save-tax">
                {pending ? "Saving..." : "Save tax info"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950">Tax IDs can&apos;t be saved until the server&apos;s encryption key is set up (FINANCE_ENCRYPTION_KEY).</p>
        )
      ) : null}

      <Modal
        open={revealOpen}
        onClose={closeReveal}
        title={`Full ${label}`}
        description="Showing this is recorded in the audit log. Close this window when you're done."
        footer={
          <Button variant="secondary" onClick={closeReveal}>
            Close
          </Button>
        }
      >
        {revealed === undefined ? (
          <div className="space-y-3">
            <p>Only finance admins can see the full number. We will record that you looked.</p>
            {error ? (
              <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
                {error}
              </p>
            ) : null}
            <Button
              disabled={revealing}
              data-testid="reveal-confirm"
              onClick={() => run(() => revealTaxIdAction(contactId), (r) => void setRevealed(r.taxId))}
            >
              {revealing ? "Loading..." : "Show it"}
            </Button>
          </div>
        ) : revealed === null ? (
          <p>There is no tax ID on file.</p>
        ) : (
          <p className="select-all text-center text-2xl font-bold tabular-nums tracking-wider" data-testid="revealed-tax-id">
            {fmt(revealed)}
          </p>
        )}
      </Modal>
    </div>
  );
}
