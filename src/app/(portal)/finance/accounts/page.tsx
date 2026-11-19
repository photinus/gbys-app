import type { Metadata } from "next";
import Link from "next/link";
import { ActiveToggle, AccountFormButton, FundFormButton } from "@/components/finance/gl/accounts-ui";
import { guarded } from "@/components/finance/gl/guard";
import { money } from "@/components/finance/gl/format";
import { Badge, Card, CardHeader, EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { listAccounts, listFunds, listProgramOptions } from "@/lib/dal/finance-accounts";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, RESTRICTION_LABELS } from "@/lib/validation/finance-gl";

export const metadata: Metadata = { title: "Accounts & funds" };
export const dynamic = "force-dynamic";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireSession("/finance/accounts");
  const tab = (await searchParams).tab === "funds" ? "funds" : "accounts";
  const { accounts, funds, programs, canEdit } = await guarded(async () => ({
    accounts: await listAccounts(ctx),
    funds: await listFunds(ctx),
    programs: await listProgramOptions(),
    canEdit: canEditBooks(await getFinanceAccess(ctx)),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Accounts &amp; funds</h1>
        <p className="mt-1 text-sm text-stone-500">
          Accounts are the categories money is tracked in. Funds track money set aside for a purpose, like a donor-restricted gift.
        </p>
      </div>

      <nav className="flex gap-2" aria-label="Accounts or funds">
        {(["accounts", "funds"] as const).map((t) => (
          <Link
            key={t}
            href={t === "accounts" ? "/finance/accounts" : "/finance/accounts?tab=funds"}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold",
              tab === t ? "bg-charcoal text-white" : "bg-white text-stone-600 border border-line hover:bg-alabaster"
            )}
          >
            {t === "accounts" ? "Accounts" : "Funds"}
          </Link>
        ))}
      </nav>

      {tab === "accounts" ? (
        <>
          {canEdit ? (
            <div className="flex justify-end">
              <AccountFormButton />
            </div>
          ) : null}
          {ACCOUNT_TYPES.map((type) => {
            const rows = accounts.filter((a) => a.type === type);
            if (!rows.length) return null;
            return (
              <Card key={type} data-testid={`accounts-${type}`}>
                <CardHeader title={ACCOUNT_TYPE_LABELS[type]} />
                <Table>
                  <THead>
                    <tr>
                      <TH className="w-20">No.</TH>
                      <TH>Name</TH>
                      <TH>Group</TH>
                      <TH className="text-right">Balance</TH>
                      <TH></TH>
                      {canEdit ? <TH></TH> : null}
                    </tr>
                  </THead>
                  <TBody>
                    {rows.map((a) => (
                      <TR key={a.id} className={cn(!a.isActive && "text-stone-400")} data-testid="account-row">
                        <TD className="tabular-nums">{a.code}</TD>
                        <TD>{a.name}</TD>
                        <TD className="text-xs">{a.subtype}</TD>
                        <TD className="text-right tabular-nums">{money(a.balanceCents)}</TD>
                        <TD>
                          <div className="flex flex-wrap gap-1">
                            {a.isBank ? <Badge tone="info">Bank</Badge> : null}
                            {a.is1099 ? <Badge tone="warning">1099</Badge> : null}
                            {a.systemKey ? <Badge tone="neutral">Built-in</Badge> : null}
                            {!a.isActive ? <Badge tone="neutral">Off</Badge> : null}
                          </div>
                        </TD>
                        {canEdit ? (
                          <TD className="whitespace-nowrap text-right">
                            <AccountFormButton account={a} />
                            {!a.systemKey ? <ActiveToggle kind="account" id={a.id} name={a.name} isActive={a.isActive} /> : null}
                          </TD>
                        ) : null}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            );
          })}
        </>
      ) : (
        <Card>
          <CardHeader
            title="Funds"
            description="Money spent from a donor-restricted fund is shown as released from restrictions in reports."
            action={canEdit ? <FundFormButton programs={programs} /> : undefined}
          />
          {funds.length === 0 ? (
            <EmptyState title="No funds yet" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Fund</TH>
                  <TH>Type</TH>
                  <TH>Program</TH>
                  <TH className="text-right">Received</TH>
                  <TH className="text-right">Spent</TH>
                  <TH className="text-right">Balance</TH>
                  {canEdit ? <TH></TH> : null}
                </tr>
              </THead>
              <TBody>
                {funds.map((f) => (
                  <TR key={f.id} className={cn(!f.isActive && "text-stone-400")} data-testid="fund-row">
                    <TD>
                      <span className="font-medium">{f.name}</span>
                      {!f.isActive ? <Badge tone="neutral" className="ml-2">Off</Badge> : null}
                      {f.purpose ? <span className="block max-w-[260px] truncate text-xs text-stone-500">{f.purpose}</span> : null}
                    </TD>
                    <TD>
                      <Badge tone={f.restriction === "with_donor_restrictions" ? "warning" : "neutral"}>{RESTRICTION_LABELS[f.restriction]}</Badge>
                    </TD>
                    <TD className="text-xs">{f.programName ?? ""}</TD>
                    <TD className="text-right tabular-nums">{money(f.receivedCents + f.openingCents)}</TD>
                    <TD className="text-right tabular-nums">{money(f.spentCents)}</TD>
                    <TD
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        f.restriction === "with_donor_restrictions" && f.balanceCents < 0 && "text-rose-700"
                      )}
                    >
                      {money(f.balanceCents)}
                      {f.restriction === "with_donor_restrictions" && f.balanceCents < 0 ? (
                        <span className="block text-[11px] font-medium">Overspent</span>
                      ) : null}
                    </TD>
                    {canEdit ? (
                      <TD className="whitespace-nowrap text-right">
                        <FundFormButton fund={f} programs={programs} />
                        {!f.systemKey ? <ActiveToggle kind="fund" id={f.id} name={f.name} isActive={f.isActive} /> : null}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
