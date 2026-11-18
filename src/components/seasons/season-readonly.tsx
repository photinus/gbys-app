import { Card, CardHeader } from "@/components/ui";
import type { SeasonEditorData, SeasonFormPreview } from "@/lib/dal/seasons";
import { formatCents, formatDateTime, formatDob } from "@/lib/format";
import { FormPreview } from "./form-preview";

export function SeasonReadOnly({ data, preview }: { data: SeasonEditorData; preview: SeasonFormPreview }) {
  const s = data.season;
  const rows: [string, string][] = [
    ["Fee", formatCents(s.baseFeeCents)],
    ["Season dates", s.startsOn ? `${formatDob(s.startsOn)}${s.endsOn ? ` to ${formatDob(s.endsOn)}` : ""}` : "Not set"],
    ["Registration opens", s.registrationOpensAt ? formatDateTime(s.registrationOpensAt) : "Not set"],
    ["Registration closes", s.registrationClosesAt ? formatDateTime(s.registrationClosesAt) : "No closing date"],
    [
      "Eligible birth dates",
      s.eligibleBirthDateFrom || s.eligibleBirthDateTo
        ? `${s.eligibleBirthDateFrom ? formatDob(s.eligibleBirthDateFrom) : "Any"} to ${s.eligibleBirthDateTo ? formatDob(s.eligibleBirthDateTo) : "Any"}`
        : "Open to all ages",
    ],
  ];
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Details" description="Read-only. Program admins and the board edit seasons." />
        {s.description ? <p className="mb-4 text-sm text-stone-600">{s.description}</p> : null}
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-semibold text-stone-500">{k}</dt>
              <dd className="text-charcoal">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card>
        <CardHeader title="Waiver" />
        {preview.waiver ? (
          <>
            <p className="mb-2 text-sm font-semibold text-charcoal">
              {preview.waiver.title} - {preview.waiver.version}
            </p>
            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-line bg-alabaster p-4 font-sans text-xs text-charcoal">
              {preview.waiver.body}
            </pre>
          </>
        ) : (
          <p className="text-sm text-stone-500">No waiver chosen yet.</p>
        )}
      </Card>
      <Card>
        <CardHeader title="Registration form" description="As families will see it." />
        <FormPreview fields={preview.fields} />
      </Card>
    </div>
  );
}
