import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { ContactForm } from "@/components/finance/contacts/contact-form";
import { TaxInfoForm } from "@/components/finance/contacts/tax-info-form";
import { W9Panel } from "@/components/finance/contacts/w9-panel";
import { Badge, Card, CardHeader } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, isFinanceAdmin, requireFinance } from "@/lib/dal/finance-access";
import { getPostingOptions } from "@/lib/dal/finance-accounts";
import { getContactActivity, listW9s } from "@/lib/dal/finance-contact-docs";
import { getContact } from "@/lib/dal/finance-contacts";
import { isEncryptionConfigured } from "@/lib/crypto";

export const metadata: Metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/contacts/${id}`);
  const data = await guarded(async () => {
    const access = await requireFinance(ctx, "view_all");
    const canEdit = canEditBooks(access);
    const [contact, activity] = await Promise.all([getContact(ctx, id), getContactActivity(ctx, id)]);
    const [w9s, options] = canEdit ? await Promise.all([listW9s(ctx, id), getPostingOptions(ctx)]) : [[], null];
    return { contact, activity, w9s, options, canEdit, admin: isFinanceAdmin(access) };
  });
  const { contact: c, activity, canEdit } = data;
  const accounts = (data.options?.accountGroups ?? [])
    .filter((g) => g.type === "expense")
    .flatMap((g) => g.accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` })));
  const address = [c.addressLine1, c.addressLine2, [c.city, [c.state, c.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/contacts" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Vendors &amp; contacts</Link>
        <h1 className="mt-1 break-words text-2xl font-bold tracking-tight sm:text-3xl" data-testid="contact-name">{c.displayName}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.isVendor ? <Badge tone="info">Vendor</Badge> : null}
          {c.isCustomer ? <Badge tone="success">Customer</Badge> : null}
          {c.isDonor ? <Badge tone="warning">Donor</Badge> : null}
          {c.is1099 ? <Badge>1099</Badge> : null}
          {!c.isActive ? <Badge tone="danger">Inactive</Badge> : null}
          {c.userId ? <Badge>Has a GBYS account</Badge> : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={canEdit ? "Edit details" : "Details"} />
            {canEdit ? (
              <ContactForm contact={c} accounts={accounts} />
            ) : (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Item label="Email">{c.email ?? "—"}</Item>
                <Item label="Phone">{c.phone ?? "—"}</Item>
                <Item label="Address">{address.length ? address.map((l) => <span key={l} className="block">{l}</span>) : "—"}</Item>
                <Item label="Notes">{c.notes ?? "—"}</Item>
              </dl>
            )}
          </Card>

          {c.isVendor || c.is1099 || c.taxIdLast4 ? (
            <Card>
              <CardHeader title="Tax info and W-9" description="For 1099 reporting on payments to independent contractors." />
              <TaxInfoForm
                contactId={c.id}
                taxIdType={c.taxIdType}
                taxIdLast4={c.taxIdLast4}
                w9ReceivedOn={c.w9ReceivedOn}
                canEdit={canEdit}
                canReveal={data.admin}
                encryptionReady={isEncryptionConfigured()}
              />
              {canEdit ? (
                <div className="mt-5 border-t border-line-soft pt-4">
                  <h3 className="mb-2 text-sm font-bold text-charcoal">W-9 files</h3>
                  <W9Panel contactId={c.id} files={data.w9s} />
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Activity" />
            <ul className="space-y-3 text-sm" data-testid="contact-activity">
              <li className="flex items-baseline justify-between gap-3">
                <Link href={`/finance/payables?contact=${c.id}`} className="font-semibold hover:underline">
                  Bills &amp; reimbursements
                </Link>
                <span className="tabular-nums text-stone-600">{activity.bills.count}</span>
              </li>
              {activity.bills.openCents > 0 ? <li className="text-xs text-stone-500">We owe them {money(activity.bills.openCents)} right now.</li> : null}
              {activity.paidOutCents > 0 ? <li className="text-xs text-stone-500">Paid so far: {money(activity.paidOutCents)}.</li> : null}
              {c.isCustomer || activity.invoices.count > 0 ? (
                <li className="flex items-baseline justify-between gap-3">
                  <Link href={`/finance/receivables?customer=${c.id}`} className="font-semibold hover:underline">
                    Invoices
                  </Link>
                  <span className="tabular-nums text-stone-600">{activity.invoices.count}</span>
                </li>
              ) : null}
              {activity.invoices.openCents > 0 ? <li className="text-xs text-stone-500">They owe us {money(activity.invoices.openCents)}.</li> : null}
              {c.isDonor || activity.gifts.count > 0 ? (
                <li className="flex items-baseline justify-between gap-3">
                  <Link href={`/finance/donations?donor=${c.id}`} className="font-semibold hover:underline">
                    Gifts
                  </Link>
                  <span className="tabular-nums text-stone-600">{activity.gifts.count}</span>
                </li>
              ) : null}
              {activity.gifts.totalCents > 0 ? <li className="text-xs text-stone-500">Given in total: {money(activity.gifts.totalCents)}.</li> : null}
            </ul>
            {canEdit && c.isVendor ? (
              <Link href={`/finance/payables/new?contact=${c.id}`} className="mt-4 block text-sm font-semibold underline">
                Enter a bill from {c.displayName}
              </Link>
            ) : null}
            <p className="mt-4 text-xs text-stone-400">Added {fmtDay(c.createdAt.toISOString().slice(0, 10))}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">{label}</dt>
      <dd className="mt-0.5 break-words text-charcoal">{children}</dd>
    </div>
  );
}
