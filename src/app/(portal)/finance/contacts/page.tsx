import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { Badge, Button, Card, EmptyState, Input, TBody, TD, TH, THead, TR, Table, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess, requireFinance } from "@/lib/dal/finance-access";
import { listContacts, type ContactRole } from "@/lib/dal/finance-contacts";

export const metadata: Metadata = { title: "Vendors & contacts" };
export const dynamic = "force-dynamic";

const ROLES: { key: ContactRole | "all"; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "vendor", label: "Vendors" },
  { key: "customer", label: "Customers" },
  { key: "donor", label: "Donors" },
];

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/contacts");
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const role = (ROLES.find((r) => r.key === one("role"))?.key ?? "all") as ContactRole | "all";
  const q = one("q");
  const inactive = one("inactive") === "1";
  const { rows, canEdit } = await guarded(async () => {
    await requireFinance(ctx, "view_all");
    return {
      rows: await listContacts(ctx, { role: role === "all" ? undefined : role, q, includeInactive: inactive }),
      canEdit: canEditBooks(await getFinanceAccess(ctx)),
    };
  });
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { role: role === "all" ? undefined : role, q, inactive: inactive ? "1" : undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/finance/contacts?${s}` : "/finance/contacts";
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Vendors &amp; contacts</h1>
          <p className="mt-1 text-sm text-stone-500">People and organizations we pay, bill or receive gifts from. One contact can be several of these.</p>
        </div>
        {canEdit ? (
          <Link href={`/finance/contacts/new${role !== "all" ? `?role=${role}` : ""}`} className={buttonStyles({})} data-testid="new-contact">
            New contact
          </Link>
        ) : null}
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <Link key={r.key} href={link({ role: r.key === "all" ? undefined : r.key })} className={buttonStyles({ variant: r.key === role ? "primary" : "secondary", size: "sm" })}>
              {r.label}
            </Link>
          ))}
        </div>
        <form method="get" action="/finance/contacts" className="mb-4 flex flex-col gap-2 sm:flex-row">
          {role !== "all" ? <input type="hidden" name="role" value={role} /> : null}
          <Input name="q" defaultValue={q} placeholder="Search by name or email" aria-label="Search contacts" className="sm:max-w-sm" />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
          <Link href={link({ inactive: inactive ? undefined : "1" })} className={buttonStyles({ variant: inactive ? "primary" : "secondary", size: "sm" })}>
            {inactive ? "Including inactive" : "Show inactive"}
          </Link>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No contacts found" description="Try a different search, or add a new contact." />
        ) : (
          <>
            <ul className="divide-y divide-line-soft sm:hidden" data-testid="contacts-cards">
              {rows.map((c) => (
                <li key={c.id} className="py-3">
                  <Link href={`/finance/contacts/${c.id}`} className="block space-y-1">
                    <p className="break-words text-sm font-semibold text-charcoal">{c.displayName}</p>
                    <p className="break-all text-xs text-stone-500">{c.email ?? "No email"}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <RoleBadges c={c} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Name</TH>
                    <TH>Is a</TH>
                    <TH>Email</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((c) => (
                    <TR key={c.id} data-testid="contact-row">
                      <TD>
                        <Link href={`/finance/contacts/${c.id}`} className="font-semibold text-charcoal hover:underline">
                          {c.displayName}
                        </Link>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1.5">
                          <RoleBadges c={c} />
                        </div>
                      </TD>
                      <TD className="break-all text-stone-600">{c.email ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function RoleBadges({ c }: { c: { isVendor: boolean; isCustomer: boolean; isDonor: boolean; is1099: boolean; isActive: boolean } }) {
  return (
    <>
      {c.isVendor ? <Badge tone="info">Vendor</Badge> : null}
      {c.isCustomer ? <Badge tone="success">Customer</Badge> : null}
      {c.isDonor ? <Badge tone="warning">Donor</Badge> : null}
      {c.is1099 ? <Badge>1099</Badge> : null}
      {!c.isActive ? <Badge tone="danger">Inactive</Badge> : null}
    </>
  );
}
