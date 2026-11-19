import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { ProgramEditForm } from "@/components/programs/program-edit-form";
import { ProgramRolesPanel } from "@/components/programs/program-roles-panel";
import { ConnectionBadges } from "@/components/payments-setup/connection-badges";
import { FeePreview } from "@/components/payments-setup/fee-preview";
import { PlatformFeeForm } from "@/components/payments-setup/platform-fee-form";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import { getProgramAdmin, listCredentialOptions, listProgramRoles } from "@/lib/dal/programs";
import { getProgramHub } from "@/lib/dal/seasons";
import { getPaymentSetup } from "@/lib/dal/stripe-connect";
import { getProgramRoleSummary } from "@/lib/dal/volunteer-roles";

export const metadata: Metadata = { title: "Program" };

export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/admin/programs/${id}`);
  if (!isBoard(ctx)) notFound();

  let program;
  try {
    program = await getProgramAdmin(ctx, id);
  } catch (err) {
    if (err instanceof DalError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const [credentials, roles, hub, roleSummary, payments] = await Promise.all([
    listCredentialOptions(ctx, id),
    listProgramRoles(ctx, id),
    getProgramHub(ctx, program.slug),
    getProgramRoleSummary(ctx, id),
    getPaymentSetup(ctx, id),
  ]);
  const base = `/programs/${program.slug}`;
  const activeSeasons = hub.seasons.filter((s) => s.isActive);
  const linkCls = "text-sm font-semibold text-indigo-700 hover:underline";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/programs" className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-charcoal">
          <ArrowLeft className="h-3.5 w-3.5" /> All programs
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{program.name}</h1>
      </div>

      {!program.isActive ? <InactiveProgramBanner /> : null}

      <Card data-testid="program-management">
        <CardHeader title="Program management" description="Seasons, registrations, rosters and volunteer roles live in the program hub" />
        <ul className="divide-y divide-line-soft">
          <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link href={base} className={linkCls}>Seasons &amp; registration</Link>
              <p className="text-xs text-stone-500">
                {hub.seasons.length} {hub.seasons.length === 1 ? "season" : "seasons"}, {activeSeasons.length} active
              </p>
            </div>
          </li>
          <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link href={`${base}/roles`} className={linkCls}>Volunteer roles</Link>
            </div>
            <div className="flex flex-wrap gap-2" data-testid="roles-summary">
              <Badge tone="success">{roleSummary.activeRoles} active {roleSummary.activeRoles === 1 ? "role" : "roles"}</Badge>
              <Badge tone={roleSummary.pendingSignups > 0 ? "warning" : "neutral"}>
                {roleSummary.pendingSignups} pending {roleSummary.pendingSignups === 1 ? "sign-up" : "sign-ups"}
              </Badge>
            </div>
          </li>
          {activeSeasons.map((s) => (
            <li key={s.id} data-testid="active-season" className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`${base}/seasons/${s.id}`} className="text-sm font-semibold text-charcoal hover:underline">{s.name}</Link>
                <p className="text-xs text-stone-500">{s.liveRegistrations} registered</p>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Link href={`${base}/seasons/${s.id}/registrations`} className={linkCls}>Registrations</Link>
                <Link href={`${base}/seasons/${s.id}/emergency`} className={linkCls}>Emergency sheet</Link>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card data-testid="payments-card">
        <CardHeader
          title="Payments"
          description={
            program.isIndependentPartner
              ? "Stripe connection and the GBYS platform fee for this partner league"
              : "GBYS-run program: card payments go to the GBYS account and no platform fee applies"
          }
          action={
            <Link href={`${base}/payments`} className={linkCls}>
              Payment settings
            </Link>
          }
        />
        {program.isIndependentPartner ? (
          <div className="space-y-4">
            <ConnectionBadges setup={payments} />
            {!payments.stripeEnabled ? (
              <p className="text-xs text-stone-500">Stripe is not enabled on this deployment (STRIPE_SECRET_KEY unset).</p>
            ) : null}
            <PlatformFeeForm
              programId={program.id}
              flatCents={payments.platformFeeCents}
              bps={payments.platformFeeBps}
            />
            <FeePreview rows={payments.feePreview} />
          </div>
        ) : (
          <p className="text-sm text-stone-600">
            {payments.stripeEnabled ? "Online card payments are enabled." : "Online card payments are not enabled."}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="Program details" description="Changes are audited" />
        {/* key resets uncontrolled fields after a successful save/revalidate */}
        <ProgramEditForm key={`${program.id}-${program.slug}-${program.isActive}`} program={program} credentials={credentials} />
      </Card>

      <Card>
        <CardHeader
          title="Program roles"
          description="Program admins manage shifts; head coaches and team managers can check volunteers in"
        />
        <ProgramRolesPanel programId={program.id} roles={roles} />
      </Card>
    </div>
  );
}
