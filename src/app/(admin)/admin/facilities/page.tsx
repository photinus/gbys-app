import type { Metadata } from "next";
import { Badge } from "@/components/ui";
import { DirectBookingButton } from "@/components/facilities/direct-booking";
import { RequestQueue } from "@/components/facilities/request-queue";
import { TabNav } from "@/components/facilities/tab-nav";
import { TreeEditor } from "@/components/facilities/tree-editor";
import { WeekCalendar, isYmd, mondayOf, addDaysYmd } from "@/components/facilities/week-calendar";
import { requireSession } from "@/lib/dal/context";
import { countPendingRequests, getFacilityCalendar, listBookablePrograms, listBookingRequests, listFacilities } from "@/lib/dal/facilities";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import { BOOKING_STATUSES, flattenFacilityTree, type BookingStatus } from "@/lib/validation/facilities";
import {
  approveBookingAction,
  approveSeriesAction,
  cancelBookingAction,
  deactivateFacilityAction,
  declineBookingAction,
  directBookingAction,
  reactivateFacilityAction,
  saveFacilityAction,
} from "./actions";

export const metadata: Metadata = { title: "Facilities" };
export const dynamic = "force-dynamic";

const STATUS_TABS: { id: BookingStatus; label: string }[] = [
  { id: "requested", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "declined", label: "Declined" },
  { id: "cancelled", label: "Cancelled" },
];

export default async function FacilitiesPage({ searchParams }: { searchParams: Promise<{ tab?: string; week?: string; status?: string; inactive?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireSession("/admin/facilities");
  const tab = sp.tab === "calendar" || sp.tab === "requests" ? sp.tab : "facilities";
  const pending = await countPendingRequests(ctx, { all: true });
  const tree = await listFacilities(ctx, { includeInactive: true });
  const activeFlat = flattenFacilityTree(tree).filter((f) => f.isActive);
  const programs = await listBookablePrograms(ctx);

  const bookButton = <DirectBookingButton flat={activeFlat} programs={programs} action={directBookingAction} />;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Facilities</h1>
          <p className="mt-1 text-sm text-stone-500">The facility tree, who has what booked, and field-time requests from coaches.</p>
        </div>
        {tab !== "facilities" ? bookButton : null}
      </div>
      <TabNav
        label="Facilities sections"
        active={tab}
        tabs={[
          { id: "facilities", label: "Facilities", href: "/admin/facilities?tab=facilities" },
          { id: "calendar", label: "Calendar", href: "/admin/facilities?tab=calendar" },
          {
            id: "requests",
            label: (
              <>
                Requests {pending > 0 ? <Badge tone="warning" className="!px-2 !py-0.5">{pending}</Badge> : null}
              </>
            ),
            href: "/admin/facilities?tab=requests",
          },
        ]}
      />

      {tab === "facilities" ? (
        <TreeEditor
          tree={tree}
          showInactive={sp.inactive === "1"}
          actions={{ save: saveFacilityAction, deactivate: deactivateFacilityAction, reactivate: reactivateFacilityAction }}
        />
      ) : null}

      {tab === "calendar" ? <CalendarTab ctx={ctx} week={sp.week} /> : null}

      {tab === "requests" ? <RequestsTab ctx={ctx} status={sp.status} /> : null}
    </div>
  );
}

async function CalendarTab({ ctx, week }: { ctx: Awaited<ReturnType<typeof requireSession>>; week?: string }) {
  const weekStart = mondayOf(isYmd(week) ? week : utcToLaDateInput(new Date()));
  const cal = await getFacilityCalendar(ctx, {
    from: laDateInputToUtc(weekStart, false),
    to: laDateInputToUtc(addDaysYmd(weekStart, 7), false),
  });
  return <WeekCalendar facilities={cal.facilities} bookings={cal.bookings} weekStart={weekStart} baseHref="/admin/facilities?tab=calendar" />;
}

async function RequestsTab({ ctx, status }: { ctx: Awaited<ReturnType<typeof requireSession>>; status?: string }) {
  const current = (BOOKING_STATUSES as readonly string[]).includes(status ?? "") ? (status as BookingStatus) : "requested";
  const rows = await listBookingRequests(ctx, { scope: { all: true }, status: current });
  return (
    <div className="space-y-4">
      <TabNav label="Request status" active={current} tabs={STATUS_TABS.map((t) => ({ ...t, href: `/admin/facilities?tab=requests&status=${t.id}` }))} />
      <RequestQueue
        rows={rows}
        showProgram
        actions={{ approve: approveBookingAction, approveSeries: approveSeriesAction, decline: declineBookingAction, cancel: cancelBookingAction }}
      />
    </div>
  );
}
