"use client";

import { useCallback, useState, useTransition } from "react";
import { useToast } from "@/components/ui";
import type { ActionResult } from "@/lib/dal/context";

/**
 * Runs a server action inside a transition. `onOk` may return a string to show as a
 * success toast. With `inline`, errors are kept in `error` for the caller to render
 * (modals) instead of being toasted.
 */
export function useRunner(opts: { inline?: boolean } = {}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inline = opts.inline ?? false;

  const run = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T) => string | void) => {
      setError(null);
      start(async () => {
        let r: ActionResult<T>;
        try {
          r = await fn();
        } catch {
          r = { ok: false, error: "Something went wrong. Please try again." };
        }
        if (r.ok) {
          const msg = onOk?.(r.data);
          if (typeof msg === "string" && msg) toast.success(msg);
        } else if (inline) {
          setError(r.error);
        } else {
          toast.error(r.error);
        }
      });
    },
    [toast, inline]
  );

  return { run, pending, error, setError };
}
