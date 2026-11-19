"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  saveAccountAction,
  saveFundAction,
  setAccountActiveAction,
  setFundActiveAction,
} from "@/app/(portal)/finance/accounts/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Modal, Select, Switch, Textarea, useToast } from "@/components/ui";
import type { AccountRow, FundRow, ProgramOption } from "@/lib/dal/finance-accounts";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, RESTRICTION_LABELS, RESTRICTIONS, type AccountTypeValue } from "@/lib/validation/finance-gl";

export function AccountFormButton({ account }: { account?: AccountRow }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(saveAccountAction);
  const formId = `account-form-${account?.id ?? "new"}`;
  const typeLocked = !!account && (!!account.systemKey || account.lineCount > 0);
  const [type, setType] = useState<AccountTypeValue>(account?.type ?? "expense");

  useEffect(() => {
    if (state?.ok) {
      toast.success(account ? "Account saved" : "Account added");
      setOpen(false);
      router.refresh();
    }
  }, [state, toast, router, account]);

  return (
    <>
      {account ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Edit ${account.name}`} data-testid="edit-account">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)} data-testid="add-account">
          <Plus className="h-4 w-4" /> Add account
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={account ? `Edit ${account.name}` : "Add an account"}
        description="Accounts are the categories money is tracked in."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={pending} data-testid="save-account">
              {pending ? "Saving..." : "Save account"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="space-y-4 text-sm">
          {account ? <input type="hidden" name="id" value={account.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-[130px_1fr]">
            <Field label="Account number" hint="3 to 10 digits, dots or dashes.">
              <Input name="code" required maxLength={10} defaultValue={account?.code ?? ""} placeholder="6025" />
            </Field>
            <Field label="Name">
              <Input name="name" required minLength={2} maxLength={80} defaultValue={account?.name ?? ""} />
            </Field>
          </div>
          <Field
            label="Type"
            hint={
              typeLocked
                ? account?.systemKey
                  ? "Built-in account: the type can't be changed."
                  : "This account has transactions, so the type is locked."
                : undefined
            }
          >
            <Select name="type" value={type} onChange={(e) => setType(e.target.value as AccountTypeValue)} disabled={typeLocked}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          {typeLocked ? <input type="hidden" name="type" value={type} /> : null}
          <Field label="Report group (optional)" hint="Groups accounts on reports, e.g. “Program expenses” or “Fundraising”.">
            <Input name="subtype" maxLength={60} defaultValue={account?.subtype ?? ""} />
          </Field>
          <Field label="Description (optional)">
            <Textarea name="description" rows={2} maxLength={300} defaultValue={account?.description ?? ""} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 text-sm text-charcoal">
              <Switch name="isBank" defaultChecked={account?.isBank ?? false} />
              Bank, cash or credit card
            </label>
            {type === "expense" ? (
              <label className="flex items-center gap-3 text-sm text-charcoal">
                <Switch name="is1099" defaultChecked={account?.is1099 ?? false} />
                Counts toward 1099 reporting
              </label>
            ) : null}
          </div>
          <FormError state={state} />
        </form>
      </Modal>
    </>
  );
}

export function FundFormButton({ fund, programs }: { fund?: FundRow; programs: ProgramOption[] }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(saveFundAction);
  const formId = `fund-form-${fund?.id ?? "new"}`;
  const locked = !!fund && (!!fund.systemKey || fund.lineCount > 0);
  const [restriction, setRestriction] = useState<string>(fund?.restriction ?? "with_donor_restrictions");

  useEffect(() => {
    if (state?.ok) {
      toast.success(fund ? "Fund saved" : "Fund added");
      setOpen(false);
      router.refresh();
    }
  }, [state, toast, router, fund]);

  return (
    <>
      {fund ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Edit ${fund.name}`} data-testid="edit-fund">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)} data-testid="add-fund">
          <Plus className="h-4 w-4" /> Add fund
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={fund ? `Edit ${fund.name}` : "Add a fund"}
        description="A fund tracks money set aside for a purpose, such as a donor-restricted gift."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={pending} data-testid="save-fund">
              {pending ? "Saving..." : "Save fund"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="space-y-4 text-sm">
          {fund ? <input type="hidden" name="id" value={fund.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
            <Field label="Fund name">
              <Input name="name" required minLength={2} maxLength={80} defaultValue={fund?.name ?? ""} placeholder="Baseball equipment gift" />
            </Field>
            <Field label="Code (optional)">
              <Input name="code" maxLength={12} defaultValue={fund?.code ?? ""} />
            </Field>
          </div>
          <Field
            label="Restriction"
            hint={
              locked
                ? fund?.systemKey
                  ? "The General Fund is always unrestricted."
                  : "This fund has transactions, so it can't switch between restricted and unrestricted."
                : "Donor restricted means the donor said the money must be used for a specific purpose."
            }
          >
            <Select name="restriction" value={restriction} onChange={(e) => setRestriction(e.target.value)} disabled={locked}>
              {RESTRICTIONS.map((r) => (
                <option key={r} value={r}>
                  {RESTRICTION_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          {locked ? <input type="hidden" name="restriction" value={restriction} /> : null}
          {restriction === "with_donor_restrictions" ? (
            <Field label="Program (optional)" hint="If the gift is for one program, pick it.">
              <Select name="programId" defaultValue={fund?.programId ?? ""}>
                <option value="">Not tied to one program</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Purpose (optional)">
            <Textarea name="purpose" rows={2} maxLength={300} defaultValue={fund?.purpose ?? ""} />
          </Field>
          <FormError state={state} />
        </form>
      </Modal>
    </>
  );
}

export function ActiveToggle({ kind, id, name, isActive }: { kind: "account" | "fund"; id: string; name: string; isActive: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const res = await (kind === "account" ? setAccountActiveAction : setFundActiveAction)(id, !isActive);
    setBusy(false);
    if (res.ok) {
      toast.success(`${name} ${isActive ? "turned off" : "turned on"}`);
      router.refresh();
    } else {
      setError(res.error);
      toast.error(res.error);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <Button variant="ghost" size="sm" onClick={toggle} disabled={busy} aria-label={`${isActive ? "Turn off" : "Turn on"} ${name}`} data-testid="toggle-active">
        {isActive ? "Turn off" : "Turn on"}
      </Button>
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
    </span>
  );
}
