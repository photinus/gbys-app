import { toCsv } from "@/lib/csv";
import { getSessionContext, isBoard } from "@/lib/dal/context";
import { listGrantLedgerRows, recordGrantExport } from "@/lib/dal/grants";
import { utcToLaDateTimeInput } from "@/lib/format";
import { parseGrantFilters } from "@/lib/validation/grants";
import { CATEGORY_LABELS, VERIFICATION_LABELS } from "@/lib/volunteer-categories";

export const dynamic = "force-dynamic";

const HEADERS = [
  "Activity date (LA)",
  "Volunteer",
  "Email",
  "Program",
  "Category",
  "Hours",
  "Rate/hr",
  "In-kind value",
  "Verification",
  "Approved by",
  "Approved at (LA)",
  "Description",
  "Entry ID",
];

/** Integer cents -> "1234.56" (no float math, no currency symbol so spreadsheets can sum it). */
function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  // Route handlers bypass layouts: authorize here. Hide existence from everyone but the board.
  const ctx = await getSessionContext();
  if (!ctx || !isBoard(ctx)) return notFound();

  const parsed = parseGrantFilters(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return new Response(parsed.error, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const { filters } = parsed;

  const rows = await listGrantLedgerRows(ctx, filters);
  const csv = toCsv(
    HEADERS,
    rows.map((r) => [
      r.activityDate,
      r.volunteerName,
      r.volunteerEmail,
      r.programName ?? "Org-wide",
      CATEGORY_LABELS[r.category],
      (r.minutes / 60).toFixed(2),
      dollars(r.rateCents),
      dollars(r.valueCents),
      VERIFICATION_LABELS[r.verificationMethod],
      r.approvedByName ?? "",
      r.approvedAt ? utcToLaDateTimeInput(r.approvedAt).replace("T", " ") : "",
      r.description ?? "",
      r.id,
    ]),
  );

  await recordGrantExport(ctx, filters, { format: "csv", rowCount: rows.length });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gbys-volunteer-hours_${filters.from}_${filters.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
