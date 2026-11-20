import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { ContactForm } from "@/components/finance/contacts/contact-form";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { requireFinance } from "@/lib/dal/finance-access";
import { getPostingOptions } from "@/lib/dal/finance-accounts";

export const metadata: Metadata = { title: "New contact" };
export const dynamic = "force-dynamic";

export default async function NewContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/contacts/new");
  const sp = await searchParams;
  const role = ["vendor", "customer", "donor"].includes(String(sp.role)) ? (sp.role as "vendor" | "customer" | "donor") : undefined;
  const options = await guarded(async () => {
    await requireFinance(ctx, "edit");
    return getPostingOptions(ctx);
  });
  const accounts = options.accountGroups.filter((g) => g.type === "expense").flatMap((g) => g.accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` })));
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/contacts" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Vendors &amp; contacts</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">New contact</h1>
      </div>
      <Card>
        <ContactForm accounts={accounts} defaultRole={role} />
      </Card>
    </div>
  );
}
