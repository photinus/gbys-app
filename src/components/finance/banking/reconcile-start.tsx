"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { startReconciliationAction } from "@/app/(portal)/finance/banking/actions";
import { parseSignedDollars } from "@/lib/validation/finance-banking";
import { useRunner } from "./use-runner";

export function StartReconciliationForm({ glAccountId, defaultDate }: { glAccountId: string; defaultDate: string }) {
  const router = useRouter();
  const { run, pending, error } = useRunner({ inline: true });
  const [date, setDate] = useState(defaultDate);
  const [balance, setBalance] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      data-testid="start-rec-form"
      onSubmit={(e) => {
        e.preventDefault();
        setLocalError(null);
        const cents = parseSignedDollars(balance);
        if (cents === null) return setLocalError("Enter the ending balance from your statement, e.g. 1234.56.");
        run(
          () => startReconciliationAction({ glAccountId, statementEndDate: date, endingBalanceCents: cents }),
          (r) => {
            router.push(`/finance/banking/reconcile/${r.id}`);
          }
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Statement ending date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required data-testid="rec-date" />
        </Field>
        <Field label="Statement ending balance">
          <Input inputMode="decimal" placeholder="e.g. 1234.56" value={balance} onChange={(e) => setBalance(e.target.value)} data-testid="rec-balance" />
        </Field>
      </div>
      {localError || error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {localError ?? error}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={pending || !date} data-testid="rec-start">
        {pending ? "Starting…" : "Start reconciling"}
      </Button>
    </form>
  );
}
