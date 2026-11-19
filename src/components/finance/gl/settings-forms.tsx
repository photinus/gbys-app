"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  closeBooksAction,
  grantAccessAction,
  reopenBooksAction,
  revokeAccessAction,
  searchUsersAction,
  updateSettingsAction,
} from "@/app/(portal)/finance/settings/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Badge, Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import type { AccessOverview, FinanceSettingsView } from "@/lib/dal/finance-settings";
import { FINANCE_GRANT_ROLES, FINANCE_ROLE_HELP, FINANCE_ROLE_LABELS } from "@/lib/validation/finance-gl";
import { formatDate } from "@/lib/format";
import { MONTH_NAMES, fmtDay } from "./format";

export function SettingsForm({ settings: s }: { settings: FinanceSettingsView }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(updateSettingsAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.data.changed.length ? "Settings saved" : "No changes to save");
      router.refresh();
    }
  }, [state, toast, router]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fiscal year starts in" hint="Reports default to the fiscal year you pick. Most nonprofits use January or July.">
          <Select name="fiscalYearStartMonth" defaultValue={String(s.fiscalYearStartMonth)}>
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Stripe payouts are deposited into" hint="The bank account that receives money from Stripe.">
          <Select name="stripePayoutAccountId" defaultValue={s.stripePayoutAccountId ?? ""}>
            <option value="">Not chosen yet (use Checking)</option>
            {s.bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Start recording registration payments on"
          hint="Registration payments on or after this date are recorded in the books automatically. Leave blank to keep automatic recording off."
        >
          <Input type="date" name="autoPostStartDate" defaultValue={s.autoPostStartDate ?? ""} />
        </Field>
        <Field
          label="Second approval needed at (USD, optional)"
          hint="Bills at or above this amount will need two approvers. Used by bills in a later release."
        >
          <Input
            name="dualApprovalThresholdDollars"
            inputMode="decimal"
            placeholder="e.g. 500.00"
            defaultValue={s.dualApprovalThresholdCents === null ? "" : (s.dualApprovalThresholdCents / 100).toFixed(2)}
          />
        </Field>
      </div>
      <div className="space-y-4 border-t border-line-soft pt-4">
        <div>
          <h3 className="text-sm font-semibold text-charcoal">Donation receipts</h3>
          <p className="text-xs text-stone-500">Printed on every thank-you receipt and yearly statement. The organization name, EIN and logo come from Admin settings.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Receipt signed by" hint="e.g. Jane Smith">
            <Input name="receiptSignerName" maxLength={120} defaultValue={s.receiptSignerName ?? ""} data-testid="receipt-signer-name" />
          </Field>
          <Field label="Signer's title" hint="e.g. Treasurer">
            <Input name="receiptSignerTitle" maxLength={120} defaultValue={s.receiptSignerTitle ?? ""} data-testid="receipt-signer-title" />
          </Field>
        </div>
        <Field label="Thank-you message" hint="A short paragraph shown on receipts. Leave blank for a standard thank-you.">
          <Textarea name="receiptMessage" rows={3} maxLength={1500} defaultValue={s.receiptMessage ?? ""} data-testid="receipt-message" />
        </Field>
        <Field label="How customers can pay invoices" hint="Shown on emailed invoices, e.g. “Make checks payable to … or pay online at …”.">
          <Textarea name="invoicePaymentInstructions" rows={3} maxLength={1500} defaultValue={s.invoicePaymentInstructions ?? ""} data-testid="invoice-payment-instructions" />
        </Field>
      </div>
      <FormError state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} data-testid="save-settings">
          {pending ? "Saving..." : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

export function PeriodCard({ settings: s, today }: { settings: FinanceSettingsView; today: string }) {
  const toast = useToast();
  const router = useRouter();
  const close = useActionForm(closeBooksAction);
  const reopen = useActionForm(reopenBooksAction);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (close.state?.ok) {
      toast.success("Books closed");
      router.refresh();
    }
  }, [close.state, toast, router]);
  useEffect(() => {
    if (reopen.state?.ok) {
      toast.success("Books reopened");
      setOpen(false);
      router.refresh();
    }
  }, [reopen.state, toast, router]);

  return (
    <div className="space-y-5 text-sm">
      <p className="rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-stone-600" data-testid="lock-status">
        {s.lockDate ? (
          <>
            The books are closed through <strong className="text-charcoal">{fmtDay(s.lockDate)}</strong>. Nothing on or before that day can be added, changed or
            voided.
          </>
        ) : (
          "The books are open. Close them after each month or year-end review so past numbers can't change by accident."
        )}
      </p>

      <form onSubmit={close.onSubmit} className="grid gap-4 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <Field label="Close the books through" hint={s.lockDate ? "Must be later than the current date." : undefined}>
          <Input type="date" name="lockDate" required max={today} min={s.lockDate ?? undefined} />
        </Field>
        <Field label="Note (optional)">
          <Input name="note" maxLength={300} placeholder="e.g. Reviewed October bank statement" />
        </Field>
        <Button type="submit" disabled={close.pending} data-testid="close-books">
          {close.pending ? "Closing..." : "Close books"}
        </Button>
        <div className="sm:col-span-3">
          <FormError state={close.state} />
        </div>
      </form>

      {s.lockDate ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="reopen-open">
            Reopen books…
          </Button>
          <Modal
            open={open}
            onClose={() => setOpen(false)}
            title="Reopen the books"
            description="Use this only to fix a mistake in a closed period. The reason is saved in the history."
            footer={
              <>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" form="reopen-form" disabled={reopen.pending} data-testid="reopen-confirm">
                  {reopen.pending ? "Reopening..." : "Reopen"}
                </Button>
              </>
            }
          >
            <form id="reopen-form" onSubmit={reopen.onSubmit} className="space-y-4 text-sm">
              <Field label="Close through this earlier date instead" hint="Leave blank to reopen everything.">
                <Input type="date" name="lockDate" max={s.lockDate} />
              </Field>
              <Field label="Reason">
                <Textarea name="reason" required minLength={3} maxLength={500} rows={3} />
              </Field>
              <FormError state={reopen.state} />
            </form>
          </Modal>
        </div>
      ) : null}

      {s.closes.length ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">History</h3>
          <ul className="divide-y divide-line-soft rounded-2xl border border-line" data-testid="close-history">
            {s.closes.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 px-3.5 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="text-charcoal">
                  {c.lockDate ? (
                    <>
                      {c.previousLockDate && c.lockDate < c.previousLockDate ? "Reopened back to " : "Closed through "}
                      <strong>{fmtDay(c.lockDate)}</strong>
                    </>
                  ) : (
                    <strong>Reopened all periods</strong>
                  )}
                  {c.note ? <span className="text-stone-500"> · {c.note}</span> : null}
                </span>
                <span className="text-stone-400">
                  {c.changedByName ?? "Someone"} · {formatDate(c.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function AccessCard({ access }: { access: AccessOverview }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(grantAccessAction);
  const [picked, setPicked] = useState<{ id: string; name: string; email: string } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; email: string }[]>([]);
  const [role, setRole] = useState<string>("viewer");
  const [programId, setProgramId] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (picked || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      const res = await searchUsersAction(q);
      if (id === reqId.current && res.ok) setResults(res.data);
    }, 250);
    return () => clearTimeout(t);
  }, [q, picked]);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Access granted");
      setPicked(null);
      setQ("");
      setProgramId("");
      setRole("viewer");
      router.refresh();
    }
  }, [state, toast, router]);

  async function revoke(id: string, name: string) {
    setRevoking(id);
    setRevokeError(null);
    const res = await revokeAccessAction(id);
    setRevoking(null);
    if (res.ok) {
      toast.success(`Removed access for ${name}`);
      router.refresh();
    } else {
      setRevokeError(res.error);
    }
  }

  const roleOptions = programId ? FINANCE_GRANT_ROLES.filter((r) => r !== "admin") : FINANCE_GRANT_ROLES;

  return (
    <div className="space-y-6 text-sm">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Automatic access</h3>
        <p className="mb-2 text-xs text-stone-500">
          Super admins are finance admins and board members can view everything. This comes from their organization role, so it can&apos;t be removed here.
        </p>
        <ul className="divide-y divide-line-soft rounded-2xl border border-line" data-testid="implicit-access">
          {access.implicit.map((u) => (
            <li key={u.userId} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="font-medium text-charcoal">{u.name}</span>
                <span className="block truncate text-xs text-stone-400">{u.email}</span>
              </span>
              <Badge tone={u.level === "admin" ? "info" : "neutral"}>{u.via === "super_admin" ? "Finance admin (super admin)" : "Viewer (board member)"}</Badge>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Extra access you&apos;ve granted</h3>
        {access.grants.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-alabaster/50 px-4 py-6 text-center text-xs text-stone-500">
            Nobody has extra access yet.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-2xl border border-line" data-testid="explicit-grants">
            {access.grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="font-medium text-charcoal">{g.name}</span>
                  <span className="block truncate text-xs text-stone-400">
                    {g.email} · {g.programName ? `Only ${g.programName}` : "Whole organization"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={g.role === "admin" ? "info" : g.role === "editor" ? "success" : "neutral"}>{FINANCE_ROLE_LABELS[g.role]}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoking === g.id}
                    onClick={() => revoke(g.id, g.name)}
                    aria-label={`Remove access for ${g.name}`}
                    data-testid="revoke-access"
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {revokeError ? (
          <p role="alert" className="mt-2 rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
            {revokeError}
          </p>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-line bg-alabaster/50 p-4">
        <h3 className="text-sm font-bold text-charcoal">Give someone access</h3>
        <input type="hidden" name="userId" value={picked?.id ?? ""} />
        <div className="relative">
          <Field label="Person" hint="Search by name or email. They need to have signed in to the app before.">
            {picked ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white px-3.5 py-2" data-testid="picked-user">
                <span className="min-w-0 truncate text-sm">
                  {picked.name} <span className="text-stone-400">· {picked.email}</span>
                </span>
                <button type="button" onClick={() => setPicked(null)} aria-label="Choose someone else" className="text-stone-400 hover:text-charcoal">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Start typing a name or email…"
                  className="pl-9"
                  autoComplete="off"
                  data-testid="user-search"
                />
              </div>
            )}
          </Field>
          {!picked && results.length > 0 ? (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-white shadow-lg" data-testid="user-results">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(u)}
                    className="block w-full px-3.5 py-2 text-left text-sm hover:bg-alabaster"
                  >
                    {u.name} <span className="text-xs text-stone-400">· {u.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Where" hint="Limit to one program, or leave as the whole organization.">
            <Select
              name="programId"
              value={programId}
              onChange={(e) => {
                setProgramId(e.target.value);
                if (e.target.value && role === "admin") setRole("viewer");
              }}
            >
              <option value="">Whole organization</option>
              {access.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  Only {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role" hint={FINANCE_ROLE_HELP[role as keyof typeof FINANCE_ROLE_HELP]}>
            <Select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {FINANCE_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {programId ? (
          <p className="text-xs text-stone-500">Program access shows only that program&apos;s reports and numbers, not the journal or bank feed.</p>
        ) : null}
        <FormError state={state} />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !picked} data-testid="grant-access">
            {pending ? "Granting..." : "Grant access"}
          </Button>
        </div>
      </form>
    </div>
  );
}
