"use client";

import { useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/dal/context";

/** Run a server action from a button (no <form>), toasting the outcome. */
export function useRowAction() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, success?: string | ((data: T) => string), after?: (data: T) => void) => {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        const msg = typeof success === "function" ? success(r.data) : success;
        if (msg) toast.success(msg);
        after?.(r.data);
      } else {
        toast.error(r.error);
      }
    });
  };
  return { pending, run };
}
