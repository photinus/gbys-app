"use client";

import { useState, useTransition } from "react";
import { Button, Modal, Textarea, Field, useToast } from "@/components/ui";
import { deactivateAction, restoreAction } from "@/app/(admin)/admin/users/[id]/actions";

export function DangerZone({
  userId,
  name,
  isActive,
  canDeactivate,
  canRestore,
  isSelf,
  orgRole,
  soleGuardianAthleteCount,
}: {
  userId: string;
  name: string;
  isActive: boolean;
  canDeactivate: boolean;
  canRestore: boolean;
  isSelf: boolean;
  orgRole: string;
  soleGuardianAthleteCount: number;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    setOpen(false);
    setError(null);
    setReason("");
  };

  const deactivate = () => {
    setError(null);
    start(async () => {
      const res = await deactivateAction(userId, reason);
      if (res.ok) {
        toast.success("User deactivated");
        close();
      } else setError(res.error);
    });
  };

  const restore = () => {
    setError(null);
    start(async () => {
      const res = await restoreAction(userId);
      if (res.ok) toast.success("User restored");
      else setError(res.error);
    });
  };

  const errorBox = error ? (
    <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
      {error}
    </p>
  ) : null;

  if (!isActive) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-stone-600">
          This user is deactivated: they can&apos;t sign in and their sessions were ended. Restoring lets them sign in
          again with their existing role.
        </p>
        {errorBox}
        {canRestore ? (
          <Button variant="secondary" onClick={restore} disabled={pending}>
            {pending ? "Restoring..." : "Restore user"}
          </Button>
        ) : (
          <p className="text-xs text-stone-500">Only super admins can restore a board member or super admin.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-stone-600">
        Deactivating signs this person out everywhere and blocks sign-in until restored. Their history (hours,
        credentials, registrations) is kept.
      </p>
      {canDeactivate ? (
        <Button variant="danger" onClick={() => setOpen(true)}>
          Deactivate user
        </Button>
      ) : (
        <p className="text-xs text-stone-500" data-testid="deactivate-blocked-note">
          {isSelf
            ? "You can't deactivate yourself."
            : orgRole !== "member"
              ? "Only super admins can deactivate a board member or super admin."
              : "You can't deactivate this user."}
        </p>
      )}
      <Modal
        open={open}
        onClose={close}
        title={`Deactivate ${name}?`}
        description="They will be signed out immediately."
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deactivate} disabled={pending || reason.trim().length < 3}>
              {pending ? "Deactivating..." : "Deactivate"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          {soleGuardianAthleteCount > 0 ? (
            <p
              role="note"
              data-testid="sole-guardian-warning"
              className="rounded-xl bg-amber-soft/45 px-3.5 py-2.5 text-xs font-medium text-amber-950"
            >
              Warning: this person is the only guardian of {soleGuardianAthleteCount}{" "}
              {soleGuardianAthleteCount === 1 ? "athlete" : "athletes"}. No one else in their household will be able to
              manage {soleGuardianAthleteCount === 1 ? "that athlete" : "those athletes"} while they are deactivated.
            </p>
          ) : null}
          <Field label="Reason" hint="Recorded in the audit log.">
            <Textarea
              name="reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Requested account closure"
            />
          </Field>
          {errorBox}
        </div>
      </Modal>
    </div>
  );
}
