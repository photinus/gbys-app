import { Badge } from "@/components/ui";
import type { PaymentSetup } from "@/lib/dal/stripe-connect";

/** Connection status badges for a partner program's Stripe account. */
export function ConnectionBadges({ setup }: { setup: PaymentSetup }) {
  if (!setup.stripeAccountId) return <Badge tone="neutral">Not connected</Badge>;
  return (
    <div className="flex flex-wrap gap-2" data-testid="connection-badges">
      <Badge tone="info">Account connected</Badge>
      <Badge tone={setup.detailsSubmitted ? "success" : "warning"}>
        {setup.detailsSubmitted ? "Details submitted" : "Details needed"}
      </Badge>
      <Badge tone={setup.chargesEnabled ? "success" : "warning"}>
        {setup.chargesEnabled ? "Charges enabled" : "Charges not enabled"}
      </Badge>
      <Badge tone={setup.onboardingComplete ? "success" : "warning"}>
        {setup.onboardingComplete ? "Ready for payments" : "Setup incomplete"}
      </Badge>
    </div>
  );
}
