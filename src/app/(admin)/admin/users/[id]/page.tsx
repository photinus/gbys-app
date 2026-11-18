import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { RoleBadge, StatusBadge } from "@/components/users/badges";
import { DangerZone } from "@/components/users/danger-zone";
import { UserProfileForm } from "@/components/users/profile-form";
import { RolePanel } from "@/components/users/role-panel";
import { UserAvatar } from "@/components/users/user-avatar";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import { getUserAdmin, type CredentialStatus } from "@/lib/dal/users-admin";
import { formatCents, formatDate, formatDateTime, formatHours } from "@/lib/format";
import { PROGRAM_ROLE_LABELS } from "@/lib/validation/programs";

export const metadata: Metadata = { title: "User" };

const CRED_TONE: Record<CredentialStatus, BadgeTone> = {
  verified: "success",
  pending_review: "warning",
  expired: "danger",
  rejected: "danger",
};
const CRED_LABEL: Record<CredentialStatus, string> = {
  verified: "Verified",
  pending_review: "Pending review",
  expired: "Expired",
  rejected: "Rejected",
};

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/admin/users/${id}`);
  if (!isBoard(ctx)) notFound();

  let u;
  try {
    u = await getUserAdmin(ctx, id);
  } catch (err) {
    if (err instanceof DalError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-charcoal">
          <ArrowLeft className="h-3.5 w-3.5" /> All users
        </Link>
        <div className="mt-3 flex items-center gap-4">
          <UserAvatar name={u.name} src={u.avatarUrl} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{u.name}</h1>
            <p className="truncate text-sm text-stone-500">{u.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <RoleBadge role={u.orgRole} />
              <StatusBadge active={u.isActive} />
              {u.emailBounced ? <Badge tone="warning">Email bounced</Badge> : null}
              {u.isSelf ? <Badge tone="info">You</Badge> : null}
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Profile"
          description={`Joined ${formatDate(u.createdAt)}${u.deactivatedAt ? ` · deactivated ${formatDate(u.deactivatedAt)}` : ""} · SMS opt-in ${u.smsOptIn ? "on" : "off"}`}
        />
        <UserProfileForm key={u.id} userId={u.id} name={u.name} email={u.email} phone={u.phone} />
      </Card>

      <Card>
        <CardHeader title="Org role" description="What this person can do across the whole organization" />
        <RolePanel
          key={`${u.id}-${u.orgRole}`}
          userId={u.id}
          role={u.orgRole}
          canChange={u.canChangeRole}
          isSelf={u.isSelf}
          isActive={u.isActive}
        />
      </Card>

      <Card>
        <CardHeader title="Program roles" />
        {u.programRoles.length === 0 ? (
          <EmptyState title="No program roles" description="Grant roles from a program's page." />
        ) : (
          <ul className="divide-y divide-line-soft text-sm">
            {u.programRoles.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link href={`/admin/programs/${r.programId}`} className="min-w-0 truncate font-semibold text-charcoal hover:underline">
                  {r.programName}
                </Link>
                <Badge tone={r.role === "program_admin" ? "info" : "neutral"}>{PROGRAM_ROLE_LABELS[r.role]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Credentials" description="Status only. Proof documents are reviewed in Compliance." />
        {u.credentials.length === 0 ? (
          <EmptyState title="No credentials submitted" />
        ) : (
          <ul className="divide-y divide-line-soft text-sm">
            {u.credentials.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
                <span className="font-semibold text-charcoal">{c.typeName}</span>
                <span className="flex items-center gap-2">
                  {c.expiresAt ? <span className="text-xs text-stone-500">Expires {formatDate(c.expiresAt)}</span> : null}
                  <Badge tone={CRED_TONE[c.status]}>{CRED_LABEL[c.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={`Volunteer hours ${u.hours.year}`} description="Verified hours only, valued at each entry's in-kind rate" />
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-stone-500">Verified time</dt>
            <dd className="text-xl font-bold text-charcoal">{formatHours(u.hours.verifiedMinutes)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">In-kind value</dt>
            <dd className="text-xl font-bold text-charcoal">{formatCents(u.hours.verifiedValueCents)}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Household" description="Counts only. Athlete details are visible to their guardians and program staff." />
        <p className="text-sm text-stone-600" data-testid="household-summary">
          Guardian of {u.household.athleteCount} {u.household.athleteCount === 1 ? "athlete" : "athletes"}
          {u.household.soleGuardianAthleteCount > 0
            ? ` (sole guardian of ${u.household.soleGuardianAthleteCount})`
            : ""}
          .
        </p>
      </Card>

      <Card>
        <CardHeader title="Recent activity" description="Last 20 audit entries where this person acted or was the target" />
        {u.activity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="divide-y divide-line-soft text-sm">
            {u.activity.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-charcoal">{a.action}</span>
                  <span className="ml-2 text-xs text-stone-500">
                    {a.role === "actor" ? "by this user" : `by ${a.actorName ?? "System"}`}
                  </span>
                </span>
                <span className="text-xs text-stone-500">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="border-coral/60">
        <CardHeader title="Danger zone" />
        <DangerZone
          key={`${u.id}-${u.isActive}`}
          userId={u.id}
          name={u.name}
          isActive={u.isActive}
          canDeactivate={u.canDeactivate}
          canRestore={u.canRestore}
          isSelf={u.isSelf}
          orgRole={u.orgRole}
          soleGuardianAthleteCount={u.household.soleGuardianAthleteCount}
        />
      </Card>
    </div>
  );
}
