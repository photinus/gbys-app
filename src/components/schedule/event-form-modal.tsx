"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { utcToLaDateTimeInput } from "@/lib/format";
import {
  MAX_SERIES_OCCURRENCES,
  WEEKDAY_LABELS,
  occurrenceDates,
  weekdayOfYmd,
} from "@/lib/validation/team-schedule";
import { createEventAction, updateEventAction } from "@/app/(portal)/programs/[slug]/teams/[teamId]/schedule/actions";
import type { EventItem, FacilityOption } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  slug: string;
  teamId: string;
  teamName: string;
  facilities: FacilityOption[];
  autoApproves: boolean;
  /** Present = edit mode. */
  event?: EventItem;
}

export function EventFormModal(props: Props) {
  const { open, onClose, event } = props;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event ? "Edit event" : "Add to schedule"}
      description="Times are Pacific time (Gold Beach)."
    >
      {/* Remounted per open so the form starts fresh each time. */}
      <EventForm key={event?.id ?? "new"} {...props} />
    </Modal>
  );
}

function defaultStart(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  return utcToLaDateTimeInput(d).slice(0, 11) + "17:00";
}
function addHour(local: string): string {
  return local.slice(0, 11) + String(Math.min(23, Number(local.slice(11, 13)) + 1)).padStart(2, "0") + local.slice(13);
}

function EventForm({ onClose, slug, teamId, facilities, autoApproves, event }: Props) {
  const toast = useToast();
  const editing = !!event;
  const createForm = useActionForm(createEventAction);
  const updateForm = useActionForm(updateEventAction);
  const { state, pending, onSubmit } = editing ? updateForm : createForm;

  const [kind, setKind] = useState<"practice" | "game" | "event">(event?.kind ?? "practice");
  const [site, setSite] = useState<"home" | "away" | "neutral">(event?.site ?? "home");
  const [startsAt, setStartsAt] = useState(event ? utcToLaDateTimeInput(event.startsAt) : defaultStart());
  const [endsAt, setEndsAt] = useState(event ? utcToLaDateTimeInput(event.endsAt) : addHour(defaultStart()));
  const [resourceId, setResourceId] = useState(event?.resourceId ?? "");
  const [repeats, setRepeats] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [until, setUntil] = useState("");

  const isGame = kind === "game";
  const awayGame = isGame && site === "away";
  const needsFacility = isGame && site === "home";
  const showLocationText = awayGame || (!needsFacility && resourceId === "");

  useEffect(() => {
    if (awayGame) setResourceId("");
  }, [awayGame]);

  // Preselect the weekday of the first practice when the repeat is switched on.
  useEffect(() => {
    if (repeats && weekdays.length === 0 && /^\d{4}-\d{2}-\d{2}/.test(startsAt)) {
      setWeekdays([weekdayOfYmd(startsAt.slice(0, 10))]);
    }
  }, [repeats, weekdays.length, startsAt]);

  const occurrenceCount = useMemo(() => {
    if (!repeats || !/^\d{4}-\d{2}-\d{2}/.test(startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || weekdays.length === 0) return null;
    if (until < startsAt.slice(0, 10)) return 0;
    return occurrenceDates(startsAt.slice(0, 10), { weekdays, until }).length;
  }, [repeats, startsAt, until, weekdays]);

  const result = state?.ok ? state.data : null;
  const createOutcome = !editing && result && "count" in result ? result : null;
  const skipped = createOutcome?.skipped ?? [];

  useEffect(() => {
    if (!state?.ok) return;
    if (editing) {
      const d = state.data as { rebooked: boolean };
      toast.success("Event updated", d.rebooked && !autoApproves ? "The facility change was sent for approval." : undefined);
      onClose();
    } else if ((state.data as { skipped: unknown[] }).skipped.length === 0) {
      const d = state.data as { count: number; bookingStatus: string };
      toast.success(
        d.count === 1 ? "Added to the schedule" : `${d.count} practices added`,
        d.bookingStatus === "requested" ? "Facility time was requested and awaits approval." : undefined
      );
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Series with skipped dates: keep the modal open so the coach can read what was skipped.
  if (createOutcome && skipped.length > 0) {
    return (
      <div className="space-y-4 text-sm" data-testid="series-result">
        <p className="font-semibold text-charcoal">
          {createOutcome.count} {createOutcome.count === 1 ? "practice" : "practices"} added.{" "}
          {skipped.length} {skipped.length === 1 ? "date was" : "dates were"} skipped.
        </p>
        <ul className="space-y-1.5">
          {skipped.map((s) => (
            <li key={s.date} className="rounded-xl bg-amber-soft/30 px-3 py-2 text-xs text-amber-950 break-words">
              <span className="font-semibold">{s.date}</span>: {s.reason}
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm" data-testid="event-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="teamId" value={teamId} />
      {event ? <input type="hidden" name="eventId" value={event.id} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="practice">Practice</option>
            <option value="game">Game</option>
            <option value="event">Other event</option>
          </Select>
        </Field>
        {isGame ? (
          <Field label="Home or away">
            <Select name="site" value={site} onChange={(e) => setSite(e.target.value as typeof site)}>
              <option value="home">Home game</option>
              <option value="away">Away game</option>
              <option value="neutral">Neutral site</option>
            </Select>
          </Field>
        ) : null}
      </div>

      {isGame ? (
        <Field label="Opponent">
          <Input name="opponent" maxLength={120} defaultValue={event?.opponent ?? ""} placeholder="e.g. Brookings" />
        </Field>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Starts">
          <Input name="startsAt" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Ends">
          <Input name="endsAt" type="datetime-local" required value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>

      {!awayGame ? (
        <Field
          label="Facility"
          hint={
            autoApproves
              ? "Booked right away. Double-booking is blocked."
              : "Sent to the program admin for approval. Double-booking is blocked."
          }
        >
          <Select name="resourceId" value={resourceId} onChange={(e) => setResourceId(e.target.value)} required={needsFacility}>
            <option value="">{needsFacility ? "Choose a facility" : "Somewhere else (enter a location)"}</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {"  ".repeat(f.depth)}
                {f.depth > 0 ? "- " : ""}
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {showLocationText ? (
        <Field label={awayGame ? "Game location" : "Location"} hint={awayGame ? "Address or field name of the away team." : undefined}>
          <Input name="locationText" maxLength={200} required={awayGame} defaultValue={event?.locationText ?? ""} placeholder="e.g. Brookings-Harbor HS, 625 5th St" />
        </Field>
      ) : null}

      <Field label="Title (optional)" hint="Leave blank to show the type, or the opponent for games.">
        <Input name="title" maxLength={120} defaultValue={event?.rawTitle ?? ""} />
      </Field>

      <Field label="Notes (optional)">
        <Textarea name="notes" maxLength={1000} rows={2} defaultValue={event?.notes ?? ""} placeholder="Bring water, wear white jerseys..." />
      </Field>

      {!editing && kind === "practice" ? (
        <fieldset className="space-y-3 rounded-2xl border border-line bg-alabaster/50 p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" name="repeats" checked={repeats} onChange={(e) => setRepeats(e.target.checked)} className="h-4 w-4 accent-charcoal" />
            <span className="text-sm font-semibold text-charcoal">Repeat weekly</span>
          </label>
          {repeats ? (
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-semibold text-stone-600">On these days</p>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_LABELS.map((label, i) => {
                    const on = weekdays.includes(i);
                    return (
                      <label
                        key={label}
                        className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? "border-charcoal bg-charcoal text-white" : "border-line bg-white text-stone-600"}`}
                      >
                        <input
                          type="checkbox"
                          name="weekday"
                          value={i}
                          checked={on}
                          onChange={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))}
                          className="sr-only"
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>
              <Field
                label="Repeat until"
                hint={
                  occurrenceCount === null
                    ? `Up to ${MAX_SERIES_OCCURRENCES} practices.`
                    : occurrenceCount > MAX_SERIES_OCCURRENCES
                      ? `That is ${occurrenceCount} practices; the limit is ${MAX_SERIES_OCCURRENCES}.`
                      : `${occurrenceCount} ${occurrenceCount === 1 ? "practice" : "practices"}. Dates that clash with another booking are skipped and listed afterwards.`
                }
              >
                <Input name="until" type="date" required value={until} onChange={(e) => setUntil(e.target.value)} />
              </Field>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : editing ? "Save changes" : repeats && occurrenceCount ? `Add ${occurrenceCount} practices` : "Add to schedule"}
        </Button>
      </div>
    </form>
  );
}
