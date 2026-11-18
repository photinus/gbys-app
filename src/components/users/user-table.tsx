import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { UserListRow } from "@/lib/dal/users-admin";
import { formatDate } from "@/lib/format";
import { ORG_ROLE_LABELS } from "@/lib/validation/users-admin";
import { RoleBadge, StatusBadge } from "./badges";
import { UserAvatar } from "./user-avatar";

export function UserTable({ rows }: { rows: UserListRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="No users match" description="Try a different search or clear the filters." />;
  }
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <Table className="min-w-[860px]">
          <THead>
            <tr>
              <TH className="pl-2">Person</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Joined</TH>
              <TH>Last sign-in</TH>
              <TH className="pr-2 text-right">Roles / creds</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id} data-testid="user-row">
                <TD className="pl-2">
                  <Link href={`/admin/users/${r.id}`} className="flex items-center gap-3">
                    <UserAvatar name={r.name} src={r.avatarUrl} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-charcoal hover:underline">{r.name}</span>
                      <span className="block truncate text-xs text-stone-500">{r.email}</span>
                    </span>
                  </Link>
                </TD>
                <TD>
                  <RoleBadge role={r.orgRole} />
                </TD>
                <TD>
                  <span className="inline-flex flex-wrap gap-1">
                    <StatusBadge active={r.isActive} />
                    {r.emailBounced ? <Badge tone="warning">Email bounced</Badge> : null}
                  </span>
                </TD>
                <TD className="whitespace-nowrap text-stone-600">{formatDate(r.createdAt)}</TD>
                <TD className="whitespace-nowrap text-stone-600">{r.lastSignInAt ? formatDate(r.lastSignInAt) : "Never"}</TD>
                <TD className="pr-2 text-right text-stone-600">
                  {r.programRoleCount} / {r.verifiedCredentialCount}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={r.id} data-testid="user-card">
            <Link
              href={`/admin/users/${r.id}`}
              className="block rounded-2xl border border-line bg-white p-4 hover:bg-alabaster/80"
            >
              <div className="flex items-center gap-3">
                <UserAvatar name={r.name} src={r.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-charcoal">{r.name}</div>
                  <div className="truncate text-xs text-stone-500">{r.email}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <RoleBadge role={r.orgRole} />
                <StatusBadge active={r.isActive} />
                {r.emailBounced ? <Badge tone="warning">Email bounced</Badge> : null}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-stone-500">
                <dt>Joined</dt>
                <dd className="text-right text-stone-700">{formatDate(r.createdAt)}</dd>
                <dt>Last sign-in</dt>
                <dd className="text-right text-stone-700">{r.lastSignInAt ? formatDate(r.lastSignInAt) : "Never"}</dd>
                <dt>Program roles</dt>
                <dd className="text-right text-stone-700">{r.programRoleCount}</dd>
                <dt>Verified credentials</dt>
                <dd className="text-right text-stone-700">{r.verifiedCredentialCount}</dd>
              </dl>
              <span className="sr-only">{ORG_ROLE_LABELS[r.orgRole]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
