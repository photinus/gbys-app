"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { rotateCalendarTokenAction } from "@/app/(portal)/programs/[slug]/teams/[teamId]/actions";

/** Program admins: revoke the public calendar feed link and issue a new one. */
export function RotateTokenButton({ teamId, path }: { teamId: string; path: string }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(rotateCalendarTokenAction);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Calendar link replaced");
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Reset calendar link
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reset calendar link?"
        description="Anyone subscribed with the old link stops receiving updates until they subscribe again with the new one."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="rotate-token-form" variant="danger" disabled={pending}>
              {pending ? "Resetting…" : "Reset link"}
            </Button>
          </>
        }
      >
        <form id="rotate-token-form" onSubmit={onSubmit} className="space-y-3">
          <input type="hidden" name="teamId" value={teamId} />
          <input type="hidden" name="path" value={path} />
          <FormError state={state} />
          <p className="text-sm text-stone-600">Use this if the link was shared by mistake. The new link appears on the Schedule tab.</p>
        </form>
      </Modal>
    </>
  );
}
