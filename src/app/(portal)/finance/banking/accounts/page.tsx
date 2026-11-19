import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { guard } from "@/components/finance/banking/guard";
import { AccountRow, ConnectForm, ConnectionCard } from "@/components/finance/banking/connections-panel";
import { requireSession } from "@/lib/dal/context";
import { getBankingOverview } from "@/lib/dal/finance-banking";

export const metadata: Metadata = { title: "Bank accounts" };
export const dynamic = "force-dynamic";

export default async function BankAccountsPage() {
  const ctx = await requireSession("/finance/banking/accounts");
  const o = await guard(() => getBankingOverview(ctx));
  return (
    <div className="space-y-6">
      {!o.encryptionConfigured ? (
        <div role="alert" className="flex gap-3 rounded-2xl bg-amber-soft/30 p-4 text-sm text-amber-950" data-testid="no-key-warning">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            Bank connections can&apos;t be saved yet because the server has no <code className="font-mono text-xs">FINANCE_ENCRYPTION_KEY</code>. Ask your developer to set it
            (it protects your bank credentials), then come back here.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Connections" description="Read-only access to your bank through SimpleFIN. GBYS can see transactions and balances, and can't move money." />
        {o.connections.length === 0 ? (
          <EmptyState title="No bank connected" description={o.canAdmin ? "Connect one below." : "A finance admin needs to connect your bank."} />
        ) : (
          <div className="space-y-3">
            {o.connections.map((c) => (
              <ConnectionCard key={c.id} c={c} canAdmin={o.canAdmin} canEdit={o.canEdit} />
            ))}
          </div>
        )}
      </Card>

      {o.canAdmin ? (
        <Card>
          <CardHeader
            title="Connect a bank"
            description="Create a SimpleFIN account at beta-bridge.simplefin.org, link your bank there, then choose “New connection” (or “Create setup token”) and paste the token here."
          />
          <ConnectForm />
        </Card>
      ) : null}

      {o.accounts.length > 0 ? (
        <Card>
          <CardHeader
            title="Accounts"
            description="Choose which account in your books each bank account posts to. Accounts left on “Don't import” are ignored."
          />
          <div className="space-y-3">
            {o.accounts.map((a) => (
              <AccountRow key={a.id} a={a} glOptions={o.glOptions} canEdit={o.canEdit} />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
