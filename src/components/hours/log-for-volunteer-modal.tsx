"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { logHoursForVolunteerAction } from "@/app/(admin)/admin/hours/actions";
import { HoursFields, type ProgramChoice, type RoleChoice } from "./hours-fields";

export function LogForVolunteerModal({
  programs,
  today,
  minDate,
  roles = [],
}: {
  programs: ProgramChoice[];
  today: string;
  minDate: string;
  roles?: RoleChoice[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        Log hours for a volunteer
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log hours for a volunteer"
        description="Saved as approved. Use for time the board witnessed or collected on paper."
        footer={null}
      >
        <LogForm programs={programs} today={today} minDate={minDate} roles={roles} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function LogForm({
  programs,
  today,
  minDate,
  roles,
  onDone,
}: {
  programs: ProgramChoice[];
  today: string;
  minDate: string;
  roles: RoleChoice[];
  onDone: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(logHoursForVolunteerAction);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Hours logged", "Saved as approved.");
      router.refresh();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form onSubmit={onSubmit} className="space-y-5" aria-busy={pending}>
      <HoursFields programs={programs} today={today} minDate={minDate} disabled={pending} withEmail roles={roles} />
      <FormError state={state} />
      <div className="flex items-center justify-end gap-2.5">
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Log approved hours"}
        </Button>
      </div>
    </form>
  );
}
