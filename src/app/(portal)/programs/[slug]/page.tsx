import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { SeasonStatusBadge } from "@/components/seasons/season-status-badge";
import { Badge, Card, CardHeader, EmptyState, Table, TBody, TD, TH, THead, TR, buttonStyles } from "@/components/ui";
import { countNewSubmissions } from "@/lib/dal/contact-forms";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import { getSiteSummary } from "@/lib/dal/program-sites-admin";
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
  const { program, seasons, canManage, canViewSeasonRoster, canViewSeasonConfig, myTeams } = hub;
  const showOpenColumn = canViewSeasonRoster || canViewSeasonConfig;
  const roleSummary = await getProgramRoleSummary(ctx, program.id);
  const newContact = canManage ? await countNewSubmissions(ctx, { programId: program.id }) : null;
  const siteSummary = canManage ? await getSiteSummary(ctx, program.id) : null;
  const base = `/programs/${program.slug}`;
  const board = isBoard(ctx);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {!program.isActive ? <InactiveProgramBanner /> : null}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <Link href="/programs" className="text-xs font-semibold text-stone-500 hover:text-charcoal">
            {board ? "Program hubs" : "My programs"}
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
        <div className="flex flex-wrap gap-2">
          {board ? (
            <Link href={`/admin/programs/${program.id}`} data-testid="program-settings-link" className={buttonStyles({ size: "sm", variant: "secondary" })}>
              Program settings
            </Link>
          ) : null}
          {canManage ? (
            <Link href={`${base}/schedule`} data-testid="program-schedule-link" className={buttonStyles({ size: "sm", variant: "secondary" })}>
              Facility schedule
            </Link>
          ) : null}
          {canManage ? (
            <Link href={`${base}/payments`} data-testid="program-payments-link" className={buttonStyles({ size: "sm", variant: "secondary" })}>
              Payments
            </Link>
          ) : null}
          {canManage ? (
            <Link href={`${base}/seasons/new`} className={buttonStyles({ size: "sm" })}>
              New season
            </Link>
          ) : null}
        </div>
      </div>

      {myTeams.length > 0 || !canViewSeasonRoster ? (
        <Card data-testid="your-teams">
          <CardHeader title="Your teams" description="Rosters, emergency sheets and schedules for the teams you coach or manage" />
          {myTeams.length === 0 ? (
            <p className="text-sm text-stone-500" data-testid="no-teams">
              You&apos;re not assigned to a team yet. A program admin can add you to a team.
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {myTeams.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="your-team-row">
                  <div className="min-w-0">
                    <Link href={`${base}/teams/${t.id}`} className="font-semibold text-charcoal hover:underline">
                      {t.name}
                    </Link>
                    <div className="text-xs text-stone-500">
                      {t.seasonName}
                      {t.division ? ` · ${t.division}` : ""} · {t.role.replace(/_/g, " ")}
                    </div>
                  </div>
                  <div className="flex gap-3 text-xs font-semibold">
                    <Link href={`${base}/teams/${t.id}`} className="text-indigo-700 hover:underline">
                      Roster
                    </Link>
                    <Link href={`${base}/teams/${t.id}/emergency`} className="text-indigo-700 hover:underline">
                      Emergency sheet
                    </Link>
                    <Link href={`${base}/teams/${t.id}/schedule`} className="text-indigo-700 hover:underline">
                      Schedule
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

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

      {siteSummary ? (
        <Card data-testid="home-page-card">
          <CardHeader
            title="Home page"
            description="A public page for this program that you can share with families"
            action={
              <Link href={`${base}/home-page`} data-testid="home-page-link" className={buttonStyles({ size: "sm", variant: "secondary" })}>
                {siteSummary.exists ? "Edit home page" : "Set up home page"}
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="home-page-summary">
            <Badge tone={siteSummary.isPublished ? "success" : "neutral"}>{siteSummary.isPublished ? "Published" : "Draft"}</Badge>
            {siteSummary.pathSlug ? <span className="break-all text-xs text-stone-600">/{siteSummary.pathSlug}</span> : null}
            {siteSummary.customDomain ? <span className="break-all text-xs text-stone-600">{siteSummary.customDomain}</span> : null}
            {!siteSummary.pathSlug && !siteSummary.customDomain ? <span className="text-xs text-stone-500">No address yet</span> : null}
          </div>
        </Card>
      ) : null}

      {newContact !== null ? (
        <Card>
          <CardHeader
            title="Contact forms"
            description="Public contact forms for this program, and the messages people send through them"
            action={
              <Link href={`${base}/contact`} data-testid="contact-forms-link" className={buttonStyles({ size: "sm", variant: "secondary" })}>
                Open contact inbox
              </Link>
            }
          />
          <div className="flex flex-wrap gap-2 text-sm" data-testid="contact-summary">
            <Badge tone={newContact > 0 ? "info" : "neutral"}>
              {newContact} new {newContact === 1 ? "message" : "messages"}
            </Badge>
          </div>
        </Card>
      ) : null}

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
          <Table className="min-w-[860px]" data-testid="seasons-table">
            <THead>
              <tr>
                <TH className="pl-2">Season</TH>
                <TH>Status</TH>
                <TH>Fee</TH>
                <TH>Registration window</TH>
                <TH>Registered</TH>
                <TH>Waiver</TH>
                {showOpenColumn ? <TH className="pr-2 text-right">Open</TH> : null}
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
                    {canViewSeasonRoster && s.unpaidCount > 0 ? <span className="ml-1 text-xs text-amber-800">({s.unpaidCount} unpaid)</span> : null}
                  </TD>
                  <TD className="text-xs text-stone-600">
                    {s.waiverTitle ? `${s.waiverTitle} (${s.waiverVersion})` : <span className="text-stone-400">None</span>}
                  </TD>
                  {showOpenColumn ? (
                    <TD className="pr-2 text-right text-xs font-semibold">
                      <div className="flex flex-col items-end gap-1">
                        {canViewSeasonRoster ? (
                          <>
                            <Link href={`${base}/seasons/${s.id}/registrations`} className="text-indigo-700 hover:underline">
                              Registrations
                            </Link>
                            <Link href={`${base}/seasons/${s.id}/teams`} className="text-indigo-700 hover:underline">
                              Teams
                            </Link>
                            <Link href={`${base}/seasons/${s.id}/emergency`} className="text-indigo-700 hover:underline">
                              Emergency sheet
                            </Link>
                            <Link href={`${base}/seasons/${s.id}/insurance`} className="text-indigo-700 hover:underline">
                              Insurance export
                            </Link>
                          </>
                        ) : null}
                        {canViewSeasonConfig ? (
                          <Link href={`${base}/seasons/${s.id}`} className="text-stone-600 hover:underline">
                            {canManage ? "Edit season" : "View season"}
                          </Link>
                        ) : null}
                      </div>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
