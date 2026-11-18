import { MyRegistrations } from "@/components/registration/my-registrations";
import { requireSession } from "@/lib/dal/context";
import { listMyRegistrations } from "@/lib/dal/registrations";

export const metadata = { title: "Registrations" };

export default async function RegistrationsPage() {
  const ctx = await requireSession("/registrations");
  const registrations = await listMyRegistrations(ctx);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal">Registrations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Programs your athletes are signed up for, their payment status and the waivers you signed.
        </p>
      </div>
      <MyRegistrations registrations={registrations} />
    </div>
  );
}
