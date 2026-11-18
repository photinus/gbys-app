import Link from "next/link";
import { Search } from "lucide-react";
import { buttonStyles } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ORG_ROLES, ORG_ROLE_LABELS } from "@/lib/validation/users-admin";

export interface UserFilterState {
  q?: string;
  role: "all" | (typeof ORG_ROLES)[number];
  status: "active" | "deactivated" | "all";
  bounced?: boolean;
}

export function usersHref(f: UserFilterState, page = 1): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.role !== "all") p.set("role", f.role);
  if (f.status !== "active") p.set("status", f.status);
  if (f.bounced) p.set("bounced", "1");
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/admin/users?${s}` : "/admin/users";
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
        active ? "bg-periwinkle/35 text-indigo-950" : "bg-white text-stone-600 border border-line hover:bg-alabaster"
      )}
    >
      {children}
    </Link>
  );
}

/** Plain GET form + link pills: works without client JS. */
export function UserFilters({ filters }: { filters: UserFilterState }) {
  return (
    <div className="space-y-3">
      <form action="/admin/users" method="get" className="flex flex-col gap-2 sm:flex-row" role="search">
        {filters.role !== "all" ? <input type="hidden" name="role" value={filters.role} /> : null}
        {filters.status !== "active" ? <input type="hidden" name="status" value={filters.status} /> : null}
        {filters.bounced ? <input type="hidden" name="bounced" value="1" /> : null}
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            name="q"
            type="search"
            defaultValue={filters.q ?? ""}
            placeholder="Search name or email"
            aria-label="Search users"
            maxLength={100}
            className="pl-10"
          />
        </div>
        <button type="submit" className={buttonStyles({ variant: "primary" })}>
          Search
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter by role">
          <Pill href={usersHref({ ...filters, role: "all" })} active={filters.role === "all"}>
            All roles
          </Pill>
          {ORG_ROLES.map((r) => (
            <Pill key={r} href={usersHref({ ...filters, role: r })} active={filters.role === r}>
              {ORG_ROLE_LABELS[r]}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter by status">
          <Pill href={usersHref({ ...filters, status: "active" })} active={filters.status === "active"}>
            Active
          </Pill>
          <Pill href={usersHref({ ...filters, status: "deactivated" })} active={filters.status === "deactivated"}>
            Deactivated
          </Pill>
          <Pill href={usersHref({ ...filters, status: "all" })} active={filters.status === "all"}>
            All
          </Pill>
        </div>
        {filters.bounced ? (
          <Pill href={usersHref({ ...filters, bounced: false })} active>
            Email bounced &times;
          </Pill>
        ) : null}
      </div>
    </div>
  );
}
