import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { buttonStyles } from "@/components/ui/button";
import { UserFilters, usersHref, type UserFilterState } from "@/components/users/user-filters";
import { UserTable } from "@/components/users/user-table";
import { isBoard, requireSession } from "@/lib/dal/context";
import { listUsers } from "@/lib/dal/users-admin";
import { listUsersSchema } from "@/lib/validation/users-admin";

export const metadata: Metadata = { title: "Users" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function UsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireSession("/admin/users");
  if (!isBoard(ctx)) notFound();

  const sp = await searchParams;
  // Invalid params fall back to defaults instead of erroring.
  const parsed = listUsersSchema.safeParse({
    q: one(sp.q),
    role: one(sp.role),
    status: one(sp.status),
    bounced: one(sp.bounced) === "1" ? true : undefined,
    page: one(sp.page),
  });
  const input = parsed.success ? parsed.data : listUsersSchema.parse({});
  const result = await listUsers(ctx, input);

  const filters: UserFilterState = {
    q: input.q,
    role: input.role,
    status: input.status,
    bounced: input.bounced,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Users</h1>
        <p className="mt-1 text-sm text-stone-500">
          Everyone who has signed in. Board members can edit profiles and deactivate members; only super admins
          change roles.
        </p>
      </div>
      <Card className="space-y-5">
        <UserFilters filters={filters} />
        <p className="text-xs text-stone-500" aria-live="polite">
          {result.total} {result.total === 1 ? "user" : "users"}
          {result.pageCount > 1 ? ` · page ${result.page} of ${result.pageCount}` : ""}
        </p>
        <UserTable rows={result.rows} />
        {result.pageCount > 1 ? (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-1">
            {result.page > 1 ? (
              <Link href={usersHref(filters, result.page - 1)} className={buttonStyles({ variant: "secondary", size: "sm" })}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            {result.page < result.pageCount ? (
              <Link href={usersHref(filters, result.page + 1)} className={buttonStyles({ variant: "secondary", size: "sm" })}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </Card>
    </div>
  );
}
