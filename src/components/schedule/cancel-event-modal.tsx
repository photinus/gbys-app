"use client";

import { useEffect, useState } from "react";
import { Button, Modal, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { cancelEventAction } from "@/app/(portal)/programs/[slug]/teams/[teamId]/schedule/actions";
import { formatDayShort, dayKey } from "./group";
import type { EventItem } from "./types";

export function CancelEventModal({
  event,
  slug,
  teamId,
  onClose,
}: {
  event: EventItem | null;
  slug: string;
  teamId: string;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!event}
      onClose={onClose}
      title="Cancel this event?"
      description="Families will see it struck through, and any facility booking is released."
    >
      {event ? <CancelForm key={event.id} event={event} slug={slug} teamId={teamId} onClose={onClose} /> : null}
    </Modal>
  );
}

function CancelForm({ event, slug, teamId, onClose }: { event: EventItem; slug: string; teamId: string; onClose: () => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(cancelEventAction);
  const [scope, setScope] = useState<"one" | "future">("one");

  useEffect(() => {
    if (!state?.ok) return;
    toast.success(state.data.cancelled === 1 ? "Event cancelled" : `${state.data.cancelled} events cancelled`);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="scope" value={scope} />
      <p className="text-stone-600 break-words">
        <span className="font-semibold text-charcoal">{event.title}</span> on {formatDayShort(dayKey(event.startsAt))}
      </p>
      {event.seriesId ? (
        <fieldset className="space-y-2">
          {[
            { v: "one" as const, label: "Only this practice" },
            { v: "future" as const, label: "This and all later practices in the series" },
          ].map((o) => (
            <label key={o.v} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-alabaster/50 px-3.5 py-2.5">
              <input type="radio" name="scope-choice" checked={scope === o.v} onChange={() => setScope(o.v)} className="h-4 w-4 accent-charcoal" />
              <span className="font-medium text-charcoal">{o.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onClose}>
          Keep it
        </Button>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Cancelling..." : "Cancel event"}
        </Button>
      </div>
    </form>
  );
}
