import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, CreditCard, FileWarning, MailX, ShieldCheck, UserRoundCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { AdminOverview } from "@/lib/dal/admin-overview";
import { cn } from "@/lib/utils";

function Row({
  href,
  icon,
  title,
  detail,
  count,
  tone,
  children,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  detail: string;
  count: number;
  tone: BadgeTone;
  children?: ReactNode;
}) {
  const clear = count === 0;
  return (
    <li className="rounded-2xl bg-alabaster p-3 sm:p-3.5">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            clear ? "bg-sage/35 text-emerald-800" : tone === "danger" ? "bg-coral/35 text-rose-800" : "bg-amber-soft/40 text-amber-800",
          )}
        >
          {clear ? <CheckCircle2 className="h-4 w-4" /> : icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-charcoal">{title}</p>
          <p className="text-xs text-stone-500">{detail}</p>
        </div>
        <Badge tone={clear ? "success" : tone} className="shrink-0 tabular-nums">
          {count.toLocaleString("en-US")}
        </Badge>
        <Link
          href={href}
          aria-label={`Open: ${title}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-charcoal border border-line hover:bg-stone-50"
        >
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      {children ? <div className="mt-2.5 flex flex-wrap gap-1.5 pl-12">{children}</div> : null}
    </li>
  );
}

const chip =
  "inline-flex items-center rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-50";

export function AttentionCard({ a }: { a: AdminOverview["attention"] }) {
  const total =
    a.pendingCredentials +
    a.expiringCredentials +
    a.pendingHours +
    a.unpaidRegistrations +
    a.pendingRoleSignups +
    a.bouncedEmails +
    a.draftWaiverSeasons.length;
  return (
    <Card>
      <CardHeader
        title="Needs attention"
        description={total === 0 ? "Nothing is waiting on the board right now" : "Open items across compliance, hours, registration and email"}
        action={
          <Badge tone={total === 0 ? "success" : "warning"}>{total === 0 ? "All clear" : `${total.toLocaleString("en-US")} open`}</Badge>
        }
      />
      <ul className="space-y-2.5">
        <Row
          href="/admin/compliance"
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Credentials pending review"
          detail="Submitted proofs waiting for a board decision"
          count={a.pendingCredentials}
          tone="warning"
        />
        <Row
          href="/admin/compliance"
          icon={<Clock className="h-4 w-4" />}
          title="Credentials expiring within 30 days"
          detail="Verified credentials that will need renewal"
          count={a.expiringCredentials}
          tone="warning"
        />
        <Row
          href="/admin/hours"
          icon={<Clock className="h-4 w-4" />}
          title="Self-reported hours pending"
          detail="Entries waiting for approval before they count toward grants"
          count={a.pendingHours}
          tone="warning"
        />
        <Row
          href="/admin/volunteer-roles"
          icon={<UserRoundCheck className="h-4 w-4" />}
          title="Volunteer role sign-ups pending approval"
          detail="Volunteers waiting for a manager to approve their role"
          count={a.pendingRoleSignups}
          tone="warning"
        />
        <Row
          href={a.unpaidByProgram[0] ? `/admin/programs/${a.unpaidByProgram[0].programId}` : "/admin/programs"}
          icon={<CreditCard className="h-4 w-4" />}
          title="Unpaid registrations in open seasons"
          detail="Athletes registered but not yet paid"
          count={a.unpaidRegistrations}
          tone="warning"
        >
          {a.unpaidByProgram.map((p) => (
            <Link key={p.programId} href={`/admin/programs/${p.programId}`} className={chip}>
              {p.programName} · {p.count}
            </Link>
          ))}
        </Row>
        <Row
          href="/admin/users?bounced=1"
          icon={<MailX className="h-4 w-4" />}
          title="Users with bounced email"
          detail="Notifications to these addresses are failing"
          count={a.bouncedEmails}
          tone="danger"
        />
        <Row
          href={a.draftWaiverSeasons[0] ? `/admin/programs/${a.draftWaiverSeasons[0].programId}` : "/admin/programs"}
          icon={<FileWarning className="h-4 w-4" />}
          title="Open seasons with a draft waiver"
          detail="The waiver text still says DRAFT. Fix it before families sign"
          count={a.draftWaiverSeasons.length}
          tone="danger"
        >
          {a.draftWaiverSeasons.map((s) => (
            <Link key={s.seasonId} href={`/admin/programs/${s.programId}`} className={chip}>
              <AlertTriangle className="mr-1 h-3 w-3 text-rose-600" />
              {s.programName} · {s.seasonName}
            </Link>
          ))}
        </Row>
      </ul>
    </Card>
  );
}
