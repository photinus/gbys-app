import { AlertTriangle, Phone, ShieldCheck } from "lucide-react";
import type { EmergencySheet } from "@/lib/dal/rosters";
import { formatDateTime, formatDob } from "@/lib/format";
import { formatPhone } from "@/lib/validation/household";
import { PhotoAvatar } from "@/components/photos/photo-avatar";
import { PrintButton } from "./print-button";
import { RegisterSw } from "@/components/pwa/register-sw";

/** tel: href that cannot carry anything but dialable characters. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function PhoneLink({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-stone-500">no phone</span>;
  return (
    <a
      href={telHref(phone)}
      className="inline-flex items-center gap-1.5 rounded-full bg-charcoal px-3.5 py-2 text-sm font-bold text-white print:bg-transparent print:px-0 print:text-black"
    >
      <Phone className="h-4 w-4 print:hidden" aria-hidden />
      {formatPhone(phone)}
    </a>
  );
}

export function EmergencySheetView({ sheet }: { sheet: EmergencySheet }) {
  const alerts = sheet.athletes.filter((a) => a.medicalNotes?.trim()).length;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              {sheet.team ? "Team emergency sheet" : "Season emergency sheet"}
            </p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {sheet.team ? `${sheet.team.name} · ` : ""}
              {sheet.header.programName} · {sheet.header.seasonName}
            </h1>
            {sheet.team?.division ? <p className="text-sm text-stone-600">{sheet.team.division}</p> : null}
            <p className="mt-1 text-sm text-stone-600">
              {sheet.athletes.length} athletes · {alerts} with medical notes · generated{" "}
              <span data-testid="generated-at">{formatDateTime(sheet.generatedAt)}</span>
            </p>
          </div>
          <PrintButton />
        </div>
        <div className="print:hidden">
          <RegisterSw />
        </div>
        <p className="flex items-start gap-2 rounded-2xl bg-amber-soft/40 px-4 py-3 text-xs font-medium text-amber-950">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Confidential children&apos;s health information. Do not share or photograph. Opening this page is
          logged. The saved offline copy is erased when you sign out.
        </p>
      </div>

      {sheet.staff.length > 0 ? (
        <section className="rounded-2xl border-2 border-charcoal bg-white p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-stone-500">{sheet.team ? "Team staff" : "Program staff"}</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {sheet.staff.map((s, i) => (
              <li key={`${s.name}-${s.role}-${i}`} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base font-semibold">
                  {s.name} <span className="text-xs font-medium text-stone-500">{s.role.replace(/_/g, " ")}</span>
                </span>
                <PhoneLink phone={s.phone} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sheet.athletes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-white p-8 text-center text-sm text-stone-500">
          No registered athletes yet.
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {sheet.athletes.map((a) => {
            const medical = a.medicalNotes?.trim();
            return (
              <li
                key={a.registrationId}
                className="break-inside-avoid rounded-2xl border-2 border-charcoal bg-white p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <PhotoAvatar name={`${a.firstName} ${a.lastName}`} src={a.photoUrl} size="lg" />
                    <div className="min-w-0">
                      <h2 className="break-words text-xl font-extrabold leading-tight">
                        {a.firstName} {a.lastName}
                      </h2>
                      <p className="text-sm text-stone-600">
                        {a.age !== null ? `Age ${a.age} · ` : ""}DOB {formatDob(a.dateOfBirth)}
                      </p>
                    </div>
                  </div>
                  {medical ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-700 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white print:border print:border-black print:bg-white print:text-black">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      Medical alert
                    </span>
                  ) : (
                    <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
                      No medical notes
                    </span>
                  )}
                </div>

                {medical ? (
                  <p className="mt-3 whitespace-pre-wrap break-words rounded-xl border-2 border-rose-700 bg-rose-50 p-3 text-base font-semibold text-rose-950">
                    {medical}
                  </p>
                ) : null}

                <div className="mt-4 space-y-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">Emergency contacts</h3>
                    {a.emergencyContacts.length === 0 ? (
                      <p className="mt-1 text-sm text-stone-500">None on file. Call a guardian.</p>
                    ) : (
                      <ul className="mt-1 space-y-2">
                        {a.emergencyContacts.map((c, i) => (
                          <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-base font-semibold">
                              {c.name}{" "}
                              <span className="text-xs font-medium text-stone-500">{c.relationship}</span>
                            </span>
                            <PhoneLink phone={c.phone} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-stone-500">Guardians</h3>
                    {a.guardians.length === 0 ? (
                      <p className="mt-1 text-sm text-stone-500">No guardians on file.</p>
                    ) : (
                      <ul className="mt-1 space-y-2">
                        {a.guardians.map((g, i) => (
                          <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-base font-semibold">
                              {g.name} <span className="text-xs font-medium text-stone-500">{g.relationship}</span>
                            </span>
                            <PhoneLink phone={g.phone} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
