"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { logMyHoursAction } from "@/app/(portal)/volunteer/hours/actions";
import { HoursFields, type ProgramChoice, type RoleChoice } from "./hours-fields";

export function LogHoursForm({
  programs,
  today,
  minDate,
  roles = [],
  defaultRoleId = "",
}: {
  programs: ProgramChoice[];
  today: string;
  minDate: string;
  roles?: RoleChoice[];
  defaultRoleId?: string;
}) {
  const [resetKey, setResetKey] = useState(0);
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useActionForm(logMyHoursAction);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setResetKey((k) => k + 1); // remounts the controlled fields (role, program, category, date)
      toast.success("Hours submitted", "A board member will review them.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5" aria-busy={pending}>
      <HoursFields
        key={resetKey}
        programs={programs}
        today={today}
        minDate={minDate}
        disabled={pending}
        roles={roles}
        defaultRoleId={defaultRoleId}
      />
      <FormError state={state} />
      <Button type="submit" disabled={pending} className="w-full py-3.5 text-base sm:w-auto">
        <Clock className="h-4 w-4" />
        {pending ? "Submitting..." : "Submit hours"}
      </Button>
    </form>
  );
}
