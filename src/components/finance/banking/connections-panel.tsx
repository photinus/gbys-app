"use client";

import { Landmark, Unplug } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { connectAction, disconnectAction, updateMappingAction } from "@/app/(portal)/finance/banking/actions";
import type { BankAccountView, BankingOverview, ConnectionView } from "@/lib/dal/finance-banking";
import { formatCents, formatDateTime } from "@/lib/format";
import { SyncButton } from "./sync-button";
import { useRunner } from "./use-runner";

export function ConnectForm() {
  const { run, pending, error } = useRunner({ inline: true });
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  return (
    <form
      className="space-y-4"
      data-testid="connect-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => connectAction({ token, label }),
          (r) => {
            setToken("");
            setLabel("");
            return r.warning ? `Connected with a note: ${r.warning}` : `Connected. Found ${r.accounts} account${r.accounts === 1 ? "" : "s"}.`;
          }
        );
      }}
    >
      <Field label="Name for this connection" hint="For example: Gold Beach Credit Union">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} data-testid="connect-label" />
      </Field>
      <Field label="SimpleFIN setup token" hint="Paste the long code from your SimpleFIN account. It works only once and is never shown again.">
        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="aHR0cHM6Ly9…"
          data-testid="connect-token"
          type="password"
        />
      </Field>
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || !token.trim() || !label.trim()} data-testid="connect-submit">
        <Landmark className="h-4 w-4" />
        {pending ? "Connecting…" : "Connect bank"}
      </Button>
    </form>
  );
}

const STATUS_TONE = { ok: "success", partial: "warning", error: "danger" } as const;
const STATUS_LABEL = { ok: "Working", partial: "Needs attention", error: "Problem" } as const;

export function ConnectionCard({ c, canAdmin, canEdit }: { c: ConnectionView; canAdmin: boolean; canEdit: boolean }) {
  const { run, pending } = useRunner();
  const status = (c.lastSyncStatus ?? "") as keyof typeof STATUS_TONE;
  return (
    <div className="space-y-2 rounded-2xl border border-line p-4" data-testid="connection-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-charcoal">{c.label}</p>
          <p className="text-xs text-stone-500">
            {c.lastSyncAt ? `Last synced ${formatDateTime(c.lastSyncAt)}` : "Not synced yet"}
          </p>
        </div>
        {status in STATUS_TONE ? <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge> : null}
      </div>
      {c.lastSyncMessages.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-stone-600">
          {c.lastSyncMessages.map((m, i) => (
            <li key={i} className="break-words">
              {m}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canEdit ? <SyncButton /> : null}
        {canAdmin ? (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            data-testid="disconnect"
            onClick={() => {
              if (window.confirm(`Disconnect "${c.label}"? No new transactions will be imported. Existing ones are kept.`)) {
                run(() => disconnectAction(c.id), () => "Disconnected.");
              }
            }}
          >
            <Unplug className="h-4 w-4" /> Disconnect
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AccountRow({ a, glOptions, canEdit }: { a: BankAccountView; glOptions: BankingOverview["glOptions"]; canEdit: boolean }) {
  const { run, pending, error } = useRunner({ inline: true });
  const [gl, setGl] = useState(a.glAccountId ?? "");
  const [start, setStart] = useState(a.importStartDate ?? "");
  const dirty = gl !== (a.glAccountId ?? "") || start !== (a.importStartDate ?? "");
  return (
    <form
      className="space-y-3 rounded-2xl border border-line p-4"
      data-testid="account-row"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => updateMappingAction({ bankAccountId: a.id, glAccountId: gl || null, importStartDate: start }),
          () => (gl ? "Saved. New transactions will import on the next sync." : "Saved.")
        );
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-charcoal">{a.name}</p>
          <p className="text-xs text-stone-500">
            {[a.institution, a.connectionLabel].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">{a.balanceCents === null ? "" : formatCents(a.balanceCents)}</p>
          <p className="text-[11px] text-stone-400">{a.balanceAsOf ? `Bank balance, ${formatDateTime(a.balanceAsOf)}` : "Bank balance"}</p>
        </div>
      </div>
      {!a.glAccountId ? <Badge tone="warning">Not importing yet</Badge> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Post to this account in your books"
          hint={a.hasTransactions ? "Locked because transactions were already imported." : undefined}
        >
          <Select value={gl} onChange={(e) => setGl(e.target.value)} disabled={!canEdit || a.hasTransactions} data-testid="gl-select">
            <option value="">Don&apos;t import this account</option>
            {glOptions.map((g) => (
              <option key={g.id} value={g.id} disabled={!!g.mappedTo && g.id !== a.glAccountId}>
                {g.label}
                {g.mappedTo && g.id !== a.glAccountId ? ` (used by ${g.mappedTo})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Import transactions from" hint="Earlier ones are skipped. Use the day after your opening balance.">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={!canEdit} required data-testid="start-date" />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
      {canEdit ? (
        <Button type="submit" size="sm" disabled={pending || !dirty || !start} data-testid="save-mapping">
          {pending ? "Saving…" : "Save"}
        </Button>
      ) : null}
      {a.newCount > 0 ? <p className="text-xs text-stone-500">{a.newCount} waiting in your inbox.</p> : null}
    </form>
  );
}
