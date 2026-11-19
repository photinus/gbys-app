import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { DirectBookingButton } from "@/components/facilities/direct-booking";
import { RequestQueue } from "@/components/facilities/request-queue";
import { TabNav } from "@/components/facilities/tab-nav";
import { WeekCalendar, addDaysYmd, isYmd, mondayOf } from "@/components/facilities/week-calendar";
import { DalError, requireSession } from "@/lib/dal/context";
import { countPendingRequests, getFacilityCalendar, getProgramForSchedule, listBookingRequests, listFacilities } from "@/lib/dal/facilities";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import { BOOKING_STATUSES, flattenFacilityTree, type BookingStatus } from "@/lib/validation/facilities";
import { approveBookingAction, approveSeriesAction, cancelBookingAction, declineBookingAction, directBookingAction } from "./actions";

export const metadata: Metadata = { title: "Facility schedule" };
export const dynamic = "force-dynamic";

const STATUS_TABS: { id: BookingStatus; label: string }[] = [
  { id: "requested", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "declined", label: "Declined" },
  { id: "cancelled", label: "Cancelled" },
];

export default async function ProgramSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; week?: string; status?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireSession(`/programs/${slug}/schedule`);
  let program;
  try {
    program = await getProgramForSchedule(ctx, slug);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const scope = { programId: program.id };
  const base = `/programs/${program.slug}/schedule`;
  const tab = sp.tab === "calendar" ? "calendar" : "requests";
  const pending = await countPendingRequests(ctx, scope);
  const flat = flattenFacilityTree(await listFacilities(ctx)).filter((f) => f.isActive);
  const actions = { approve: approveBookingAction, approveSeries: approveSeriesAction, decline: declineBookingAction, cancel: cancelBookingAction };

  let body;
  if (tab === "calendar") {
    const weekStart = mondayOf(isYmd(sp.week) ? sp.week : utcToLaDateInput(new Date()));
    const cal = await getFacilityCalendar(ctx, {
      from: laDateInputToUtc(weekStart, false),
      to: laDateInputToUtc(addDaysYmd(weekStart, 7), false),
      programId: program.id,
    });
    body = <WeekCalendar facilities={cal.facilities} bookings={cal.bookings} weekStart={weekStart} baseHref={`${base}?tab=calendar`} />;
  } else {
    const current = (BOOKING_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as BookingStatus) : "requested";
    const rows = await listBookingRequests(ctx, { scope, status: current });
    body = (
      <div className="space-y-4">
        <TabNav label="Request status" active={current} tabs={STATUS_TABS.map((t) => ({ ...t, href: `${base}?status=${t.id}` }))} />
        <RequestQueue rows={rows} showProgram={false} actions={actions} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {!program.isActive ? <InactiveProgramBanner /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/programs/${program.slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
            {program.name}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">Facility schedule</h1>
          <p className="mt-1 text-sm text-stone-500">Approve or decline field-time requests, book facilities directly, and see what is taken.</p>
        </div>
        <DirectBookingButton flat={flat} programs={[]} fixedProgramId={program.id} action={directBookingAction} />
      </div>
      <TabNav
        label="Schedule sections"
        active={tab}
        tabs={[
          {
            id: "requests",
            label: (
              <>
                Requests {pending > 0 ? <Badge tone="warning" className="!px-2 !py-0.5">{pending}</Badge> : null}
              </>
            ),
            href: base,
          },
          { id: "calendar", label: "Calendar", href: `${base}?tab=calendar` },
        ]}
      />
      {body}
    </div>
  );
}
