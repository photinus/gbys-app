"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { openingBalancesAction } from "@/app/(portal)/finance/journal/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Select, useToast } from "@/components/ui";
import type { PostingOptions } from "@/lib/dal/finance-accounts";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE_LABELS } from "@/lib/validation/finance-gl";
import { money, parseMoney } from "./format";

/** Enter what each account held on the day you start using the books; net assets are balanced automatically. */
export function OpeningBalancesForm({ options, today }: { options: PostingOptions; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(openingBalancesAction);
  const groups = options.accountGroups.filter((g) => g.type === "asset" || g.type === "liability");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [funds, setFunds] = useState<Record<string, string>>({});

  const { rows, assets, liabilities, bad } = useMemo(() => {
    const rows: { accountId: string; fundId: string; amountCents: number }[] = [];
    let assets = 0;
    let liabilities = 0;
    let bad = false;
    for (const g of groups) {
      for (const a of g.accounts) {
        const raw = amounts[a.id] ?? "";
        if (!raw.trim()) continue;
        const cents = parseMoney(raw, true);
        if (cents === null) {
          bad = true;
          continue;
        }
        if (cents === 0) continue;
        rows.push({ accountId: a.id, fundId: funds[a.id] || options.generalFundId, amountCents: cents });
        if (g.type === "asset") assets += cents;
        else liabilities += cents;
      }
    }
    return { rows, assets, liabilities, bad };
  }, [amounts, funds, groups, options.generalFundId]);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Opening balances posted");
      router.push(`/finance/journal/${(state.data as { entryId: string }).entryId}`);
    }
  }, [state, toast, router]);

  return (
    <form onSubmit={onSubmit} className="space-y-5 text-sm">
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <Field label="Balances as of" hint="Usually the day before your first bank transaction.">
          <Input type="date" name="asOfDate" required defaultValue={today} />
        </Field>
        <Field label="Memo">
          <Input name="memo" maxLength={500} defaultValue="Opening balances" />
        </Field>
      </div>

      {groups.map((g) => (
        <section key={g.type}>
          <h3 className="mb-2 text-sm font-bold text-charcoal">{ACCOUNT_TYPE_LABELS[g.type]}</h3>
          <ul className="divide-y divide-line-soft rounded-2xl border border-line bg-white">
            {g.accounts.map((a) => {
              const raw = amounts[a.id] ?? "";
              const invalid = raw.trim() !== "" && parseMoney(raw, true) === null;
              return (
                <li key={a.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_190px_140px] sm:items-center">
                  <span className="min-w-0 text-sm text-charcoal">
                    <span className="text-stone-400">{a.code}</span> {a.name}
                  </span>
                  <Select
                    aria-label={`Fund for ${a.name}`}
                    value={funds[a.id] ?? options.generalFundId}
                    onChange={(e) => setFunds({ ...funds, [a.id]: e.target.value })}
                  >
                    {options.funds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`Balance for ${a.name}`}
                    aria-invalid={invalid}
                    value={raw}
                    onChange={(e) => setAmounts({ ...amounts, [a.id]: e.target.value })}
                    className="text-right tabular-nums"
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className={cn("rounded-2xl bg-alabaster px-4 py-3 text-xs text-stone-600")}>
        <p>
          Enter amounts as positive numbers (use a minus sign for things like accumulated depreciation). Whatever is left after
          subtracting what you owe from what you own is recorded as net assets:{" "}
          <strong data-testid="net-assets-total" className="text-charcoal">
            {money(assets - liabilities)}
          </strong>
          . Money in a donor-restricted fund is recorded as restricted net assets.
        </p>
      </div>

      {bad ? (
        <p role="alert" className="text-xs font-medium text-rose-700">
          One of the amounts isn&apos;t a valid number.
        </p>
      ) : null}
      <FormError state={state} />
      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || rows.length === 0 || bad} data-testid="submit-opening">
          {pending ? "Posting..." : "Post opening balances"}
        </Button>
      </div>
    </form>
  );
}
