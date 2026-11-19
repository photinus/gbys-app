import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge, Card, CardHeader, buttonStyles } from "@/components/ui";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { ConnectActions } from "@/components/payments-setup/connect-actions";
import { ConnectionBadges } from "@/components/payments-setup/connection-badges";
import { FeePreview } from "@/components/payments-setup/fee-preview";
import { DalError, requireSession } from "@/lib/dal/context";
import { getPaymentSetup, resolveManagedProgramId } from "@/lib/dal/stripe-connect";
import { formatCents, formatDateTime } from "@/lib/format";
import { formatBpsAsPercent } from "@/lib/validation/payments-settings";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, { tone: string; text: string }> = {
  ready: { tone: "bg-sage/30 text-emerald-950", text: "Stripe is connected and ready to take card payments." },
  pending: {
    tone: "bg-amber-soft/40 text-amber-950",
    text: "Stripe still needs some details before card payments can start. Use Continue setup to finish.",
  },
  error: { tone: "bg-coral/25 text-rose-900", text: "We could not check your Stripe account just now. Please try again." },
};

export default async function ProgramPaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ connect?: string }>;
}) {
  const { slug } = await params;
  const { connect } = await searchParams;
  const ctx = await requireSession(`/programs/${slug}/payments`);
  let setup;
  try {
    setup = await getPaymentSetup(ctx, await resolveManagedProgramId(ctx, slug));
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const { program, route } = setup;
  const notice = connect ? NOTICES[connect] : undefined;
  const ready = route.ready && route.stripeAccountId !== null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {!program.isActive ? <InactiveProgramBanner /> : null}
      <div className="min-w-0">
        <Link href={`/programs/${program.slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          {program.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">Payments</h1>
        <p className="mt-1 text-sm text-stone-500">How families&apos; card payments for this program are collected.</p>
      </div>

      {notice ? (
        <p role="status" data-testid="connect-notice" className={`rounded-xl px-3.5 py-2.5 text-sm font-medium ${notice.tone}`}>
          {notice.text}
        </p>
      ) : null}

      {!program.isIndependentPartner ? (
        <Card data-testid="payments-gbys-run">
          <CardHeader
            title="Card payments go to the GBYS account"
            description="This is a GBYS-run program, so there is nothing to connect."
            action={
              <Badge tone={setup.stripeEnabled ? "success" : "neutral"}>
                {setup.stripeEnabled ? "Online payments enabled" : "Online payments not enabled"}
              </Badge>
            }
          />
          <p className="text-sm text-stone-600">
            {setup.stripeEnabled
              ? "Families can pay registration fees by card on Stripe-hosted checkout. No GBYS platform fee applies to GBYS-run programs."
              : "Online card payments are not turned on yet. Record cash or check payments from the roster in the meantime."}
          </p>
        </Card>
      ) : (
        <Card data-testid="payments-partner">
          <CardHeader
            title="Stripe account"
            description="Your league is the merchant of record: payments land in your own Stripe account, and you handle refunds and disputes in your Stripe dashboard."
            action={ready ? <Badge tone="success">Ready for payments</Badge> : undefined}
          />
          {route.ready || route.reason !== "stripe_disabled" ? (
            <div className="space-y-4">
              <ConnectionBadges setup={setup} />
              {!setup.stripeAccountId ? (
                <p className="text-sm text-stone-600">
                  Connect a Stripe account to accept card payments. You will be taken to Stripe to create or sign in to your account, then
                  brought back here.
                </p>
              ) : !setup.onboardingComplete ? (
                <p className="text-sm text-stone-600">
                  Your Stripe account is created but not ready to take payments yet. Finish setup on Stripe, then check the status here.
                </p>
              ) : (
                <p className="text-sm text-stone-600">
                  Card payments for this program are live. Manage payouts, refunds and disputes in your Stripe dashboard.
                </p>
              )}
              <ConnectActions programId={program.id} connected={!!setup.stripeAccountId} ready={ready} />
              {setup.stripeAccountId ? (
                <p className="text-xs text-stone-500">
                  {setup.syncedAt ? `Last synced ${formatDateTime(setup.syncedAt)}.` : "Not synced yet."}
                </p>
              ) : null}
              <a
                href="https://dashboard.stripe.com"
                target="_blank"
                rel="noopener noreferrer"
                className={buttonStyles({ variant: "secondary", size: "sm", className: "gap-1.5" })}
                data-testid="stripe-dashboard-link"
              >
                Open Stripe dashboard <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ) : (
            <p className="text-sm text-stone-600" data-testid="stripe-disabled">
              Online card payments are not enabled for GBYS yet, so Stripe cannot be connected. Record cash or check payments from the
              roster in the meantime.
            </p>
          )}
        </Card>
      )}

      {program.isIndependentPartner ? (
        <Card data-testid="platform-fee-readonly">
          <CardHeader
            title="GBYS platform fee"
            description={setup.canSetFee ? "Edit it on the admin program page." : "Set by the GBYS board."}
          />
          <p className="mb-3 text-sm text-stone-700">
            <span className="font-semibold text-charcoal">{formatCents(setup.platformFeeCents)}</span> flat +{" "}
            <span className="font-semibold text-charcoal">{formatBpsAsPercent(setup.platformFeeBps)}</span> of each registration fee.
            Families pay exactly the posted fee.
          </p>
          <FeePreview rows={setup.feePreview} />
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Payment ledger" description="Every charge, refund, dispute and offline payment for this program" />
        <Link
          href={`/programs/${program.slug}/payments/ledger`}
          className="text-sm font-semibold text-indigo-700 hover:underline"
          data-testid="ledger-link"
        >
          View payment ledger
        </Link>
      </Card>
    </div>
  );
}
