import Link from "next/link";
import { AlertCircle, ChevronRight } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { MemberDashboard } from "@/lib/dal/dashboard";
import { formatCents, formatDob } from "@/lib/format";
import { MemberAvatar } from "./member-avatar";

const seeAll = "text-sm font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle rounded";

const PAYMENT: Record<MemberDashboard["registrations"][number]["paymentStatus"], { label: string; tone: BadgeTone }> = {
  unpaid: { label: "Unpaid", tone: "warning" },
  pending: { label: "Payment pending", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  waived_scholarship: { label: "Scholarship", tone: "success" },
  refunded: { label: "Refunded", tone: "neutral" },
};

function seasonDates(start: string | null, end: string | null): string | null {
  if (start && end) return `${formatDob(start)} to ${formatDob(end)}`;
  if (start) return `Starts ${formatDob(start)}`;
  if (end) return `Ends ${formatDob(end)}`;
  return null;
}

export function AttentionSection({ items, more }: { items: MemberDashboard["attention"]; more: number }) {
  if (items.length === 0) return null;
  return (
    <Card data-testid="dash-attention" className="border-amber-soft/60 bg-amber-soft/10">
      <CardHeader title="Needs your attention" description="A few things to take care of." />
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.key}>
            <Link
              href={it.href}
              className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle"
            >
              <AlertCircle aria-hidden className="h-5 w-5 shrink-0 text-amber-700" />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-semibold text-charcoal">{it.title}</span>
                <span className="block break-words text-xs text-stone-500">{it.detail}</span>
              </span>
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-stone-400" />
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="mt-3 text-xs text-stone-500">And {more} more once these are done.</p> : null}
    </Card>
  );
}

export function HouseholdSection({ members }: { members: MemberDashboard["household"] }) {
  return (
    <Card data-testid="dash-household">
      <CardHeader title="My household" action={<Link href="/household" className={seeAll}>Manage</Link>} />
      {members.length === 0 ? (
        <p className="text-sm text-stone-500">
          No athletes yet. <Link href="/household" className="font-semibold text-indigo-700 underline">Add your first athlete</Link>.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-2xl bg-alabaster/60 p-3" data-testid="dash-member">
              <MemberAvatar name={m.firstName} photoUrl={m.photoUrl} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-charcoal">{m.firstName}</p>
                {m.age !== null ? <p className="text-xs text-stone-500">Age {m.age}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function RegistrationsSection({ items }: { items: MemberDashboard["registrations"] }) {
  return (
    <Card data-testid="dash-programs">
      <CardHeader title="Registered programs" action={<Link href="/registrations" className={seeAll}>All registrations</Link>} />
      {items.length === 0 ? (
        <p className="text-sm text-stone-500">
          Nothing current or upcoming. <Link href="/programs" className="font-semibold text-indigo-700 underline">Browse programs</Link>.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((r) => {
            const p = r.paymentStatus === "unpaid" && r.feeCents === 0 ? { label: "No fee", tone: "success" as BadgeTone } : PAYMENT[r.paymentStatus];
            const dates = seasonDates(r.seasonStartsOn, r.seasonEndsOn);
            return (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl bg-alabaster/60 p-3" data-testid="dash-registration">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-charcoal">{r.athleteName}</p>
                  <p className="break-words text-xs text-stone-600">
                    {r.programName} · {r.seasonName}
                  </p>
                  {dates ? <p className="text-xs text-stone-500">{dates}</p> : null}
                </div>
                <Badge tone={p.tone}>{p.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function DuesSection({ dues }: { dues: MemberDashboard["dues"] }) {
  if (dues.totalCents <= 0) return null;
  return (
    <Card data-testid="dash-dues">
      <CardHeader
        title="Outstanding dues"
        description="Pay your program by cash or check; a coordinator will record it."
        action={<Link href="/registrations" className={seeAll}>View registrations</Link>}
      />
      <p className="text-3xl font-bold tracking-tight text-charcoal" data-testid="dash-dues-total">
        {formatCents(dues.totalCents)}
      </p>
      <ul className="mt-3 divide-y divide-line/70">
        {dues.items.map((d) => (
          <li key={d.registrationId} className="flex items-start justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 break-words text-charcoal">
              {d.athleteName}
              <span className="block text-xs text-stone-500">
                {d.programName} · {d.seasonName}
              </span>
            </span>
            <span className="shrink-0 font-semibold text-charcoal">{formatCents(d.feeCents)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RolesSection({ roles }: { roles: MemberDashboard["roles"] }) {
  return (
    <Card data-testid="dash-roles">
      <CardHeader title="My volunteer roles" action={<Link href="/volunteer/roles" className={seeAll}>{roles.length === 0 ? "Find a role" : "Manage roles"}</Link>} />
      {roles.length === 0 ? (
        <p className="text-sm text-stone-500">No volunteer roles yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl bg-alabaster/60 p-3" data-testid="dash-role">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-charcoal">{r.roleName}</p>
                <p className="break-words text-xs text-stone-500">
                  {r.programName ?? "Organization-wide"} · {r.termLabel}
                </p>
              </div>
              <Badge tone={r.status === "active" ? "success" : "warning"}>{r.status === "active" ? "Active" : "Pending"}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
