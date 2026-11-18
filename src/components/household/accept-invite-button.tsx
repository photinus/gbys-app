"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, useToast } from "@/components/ui";
import { acceptInviteAction } from "@/app/(portal)/household/actions";

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptInviteAction(token);
      if (res.ok) {
        toast.success("Invitation accepted", "The athletes are now in your household.");
        router.push("/household");
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <Button onClick={accept} disabled={pending}>
        {pending ? "Accepting..." : "Accept invitation"}
      </Button>
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}
