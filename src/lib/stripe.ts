import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  typescript: true,
});

/**
 * Creates a Checkout Session routed either to the main GBYS Stripe account
 * or directly to an independent partner league's connected Stripe account.
 */
export async function createRegistrationCheckout({
  registrationId,
  seasonName,
  athleteName,
  feeCents,
  platformFeeCents,
  connectedAccountId,
  customerEmail,
  successUrl,
  cancelUrl,
}: {
  registrationId: string;
  seasonName: string;
  athleteName: string;
  feeCents: number;
  platformFeeCents: number;
  connectedAccountId?: string | null;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}) {
  return stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: feeCents,
          product_data: {
            name: `${seasonName} Registration — ${athleteName}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      registrationId,
    },
    ...(connectedAccountId
      ? {
          payment_intent_data: {
            application_fee_amount: platformFeeCents > 0 ? platformFeeCents : undefined,
            transfer_data: {
              destination: connectedAccountId,
            },
          },
        }
      : {}),
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}
