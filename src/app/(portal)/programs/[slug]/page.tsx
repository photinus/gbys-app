import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SeasonStatusBadge } from "@/components/seasons/season-status-badge";
import { Badge, Card, CardHeader, EmptyState, Table, TBody, TD, TH, THead, TR, buttonStyles } from "@/components/ui";
import { DalError, requireSession } from "@/lib/dal/context";
import { getProgramHub } from "@/lib/dal/seasons";
import { getProgramRoleSummary } from "@/lib/dal/volunteer-roles";
import { formatCents, formatDate, formatDateTime, formatDob } from "@/lib/format";

export const metadata: Metadata = { title: "Program" };

export default async function ProgramHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireSession(`/programs/${slug}`);
  let hub;
  try {
    hub = await getProgramHub(ctx, slug);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const { program, seasons, canManage } = hub;
  const roleSummary = await getProgramRoleSummary(ctx, program.id);
  const base = `/programs/${program.slug}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <Link href="/programs" className="text-xs font-semibold text-stone-500 hover:text-charcoal">
            My programs
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">{program.name}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {program.sport}
            {program.description ? ` - ${program.description}` : ""}
          </p>
          {!canManage ? (
            <Badge className="mt-2" tone="neutral">
              Read-only
            </Badge>
          ) : null}
        </div>
        {canManage ? (
          <Link href={`${base}/seasons/new`} className={buttonStyles({ size: "sm" })}>
            New season
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader
          title="Volunteer roles"
          description="Positions volunteers can sign up for, with the hours you expect per term"
          action={
            <Link href={`${base}/roles`} className={buttonStyles({ size: "sm", variant: "secondary" })}>
              {canManage ? "Manage roles" : "View roles"}
            </Link>
          }
        />
        <div className="flex flex-wrap gap-2 text-sm" data-testid="roles-summary">
          <Badge tone="success">
            {roleSummary.activeRoles} active {roleSummary.activeRoles === 1 ? "role" : "roles"}
          </Badge>
          <Badge tone={roleSummary.pendingSignups > 0 ? "warning" : "neutral"}>
            {roleSummary.pendingSignups} pending {roleSummary.pendingSignups === 1 ? "sign-up" : "sign-ups"}
          </Badge>
        </div>
      </Card>

      <Card>
        <CardHeader title="Seasons" description="Registration windows are shown in Pacific time" />
        {seasons.length === 0 ? (
          <EmptyState
            title="No seasons yet"
            description={canManage ? "Create a season to open registration." : "A program admin will create the first season."}
            action={
              canManage ? (
                <Link href={`${base}/seasons/new`} className={buttonStyles({ size: "sm" })}>
                  New season
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table className="min-w-[860px]">
            <THead>
              <tr>
                <TH className="pl-2">Season</TH>
                <TH>Status</TH>
                <TH>Fee</TH>
                <TH>Registration window</TH>
                <TH>Registered</TH>
                <TH>Waiver</TH>
                <TH className="pr-2 text-right">Open</TH>
              </tr>
            </THead>
            <TBody>
              {seasons.map((s) => (
                <TR key={s.id} data-testid="season-row">
                  <TD className="pl-2">
                    <Link href={`${base}/seasons/${s.id}`} className="font-semibold text-charcoal hover:underline">
                      {s.name}
                    </Link>
                    {s.startsOn ? (
                      <div className="text-xs text-stone-500">
                        {formatDob(s.startsOn)}
                        {s.endsOn ? ` - ${formatDob(s.endsOn)}` : ""}
                      </div>
                    ) : null}
                  </TD>
                  <TD>
                    <SeasonStatusBadge status={s.status} />
                  </TD>
                  <TD className="text-charcoal">{s.baseFeeCents === 0 ? "Free" : formatCents(s.baseFeeCents)}</TD>
                  <TD className="text-xs text-stone-600">
                    {s.registrationOpensAt ? (
                      <>
                        {formatDate(s.registrationOpensAt)}
                        <span className="text-stone-400"> to </span>
                        {s.registrationClosesAt ? formatDateTime(s.registrationClosesAt) : "no end date"}
                      </>
                    ) : (
                      "Not scheduled"
                    )}
                  </TD>
                  <TD className="text-charcoal">
                    {s.liveRegistrations}
                    {s.unpaidCount > 0 ? <span className="ml-1 text-xs text-amber-800">({s.unpaidCount} unpaid)</span> : null}
                  </TD>
                  <TD className="text-xs text-stone-600">
                    {s.waiverTitle ? `${s.waiverTitle} (${s.waiverVersion})` : <span className="text-stone-400">None</span>}
                  </TD>
                  <TD className="pr-2 text-right text-xs font-semibold">
                    <div className="flex flex-col items-end gap-1">
                      <Link href={`${base}/seasons/${s.id}/registrations`} className="text-indigo-700 hover:underline">
                        Registrations
                      </Link>
                      <Link href={`${base}/seasons/${s.id}/emergency`} className="text-indigo-700 hover:underline">
                        Emergency sheet
                      </Link>
                      <Link href={`${base}/seasons/${s.id}`} className="text-stone-600 hover:underline">
                        {canManage ? "Edit season" : "View season"}
                      </Link>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
