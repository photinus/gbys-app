"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { syncNowAction } from "@/app/(portal)/finance/banking/actions";
import { useRunner } from "./use-runner";

/** "Sync now" with a plain-language result toast. The server enforces the 15-minute limit. */
export function SyncButton({ disabled, variant = "secondary" }: { disabled?: boolean; variant?: "primary" | "secondary" }) {
  const { run, pending } = useRunner();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={disabled || pending}
      data-testid="sync-now"
      onClick={() =>
        run(syncNowAction, (r) => {
          const parts = [`${r.imported} new transaction${r.imported === 1 ? "" : "s"}`];
          if (r.posted) parts.push(`${r.posted} sorted by rules`);
          if (r.matched) parts.push(`${r.matched} matched automatically`);
          const note = r.messages.length ? ` Note: ${r.messages.join(" ")}` : "";
          return `Synced: ${parts.join(", ")}.${note}`;
        })
      }
    >
      <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}
