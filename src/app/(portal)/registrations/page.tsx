import { CheckoutReturn } from "@/components/registration/checkout-return";
import { MyRegistrations } from "@/components/registration/my-registrations";
import { requireSession } from "@/lib/dal/context";
import { listMyRegistrations } from "@/lib/dal/registrations";

export const metadata = { title: "Registrations" };
export const dynamic = "force-dynamic";

const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{8,200}$/;

export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const ctx = await requireSession("/registrations");
  const registrations = await listMyRegistrations(ctx);
  const sp = await searchParams;

  // The URL only says which registration to look at; the status shown always comes from the database.
  const result = sp.checkout === "success" || sp.checkout === "cancelled" ? sp.checkout : null;
  const sessionId = sp.session_id && SESSION_ID_RE.test(sp.session_id) ? sp.session_id : null;
  const matched = result === "success" && sessionId ? (registrations.find((r) => r.checkoutSessionId === sessionId) ?? null) : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal">Registrations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Programs your athletes are signed up for, their payment status and the waivers you signed.
        </p>
      </div>
      {result ? <CheckoutReturn result={result} registration={matched} /> : null}
      <MyRegistrations registrations={registrations} />
    </div>
  );
}
