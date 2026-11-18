"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
import type { MotionFormOptions } from "@/lib/dal/board-motions";
import { MotionFormModal } from "./motion-form-modal";
import type { MotionActions } from "./types";

export function NewMotionButton({
  options,
  actions,
  defaultMeetingId,
  autoOpen,
}: {
  options: MotionFormOptions;
  actions: Pick<MotionActions, "create" | "update">;
  defaultMeetingId?: string | null;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!autoOpen);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="new-motion">
        <Plus className="h-4 w-4" aria-hidden /> New motion
      </Button>
      <MotionFormModal
        open={open}
        onClose={() => setOpen(false)}
        options={options}
        defaultMeetingId={defaultMeetingId}
        create={actions.create}
        update={actions.update}
      />
    </>
  );
}
