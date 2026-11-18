"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/dal/context";

/**
 * useActionState wrapper that submits via onSubmit instead of `<form action>`,
 * so React 19 does not reset the form's fields after a failed submission.
 */
export function useActionForm<T>(
  action: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>
) {
  const [state, formAction, pending] = useActionState(action, null as ActionResult<T> | null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };
  return { state, pending, onSubmit };
}
