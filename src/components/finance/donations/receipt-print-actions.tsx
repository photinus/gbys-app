"use client";

import { Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAnnualAction, markReceiptAction } from "@/app/(portal)/finance/donations/actions";
import { Button, useToast } from "@/components/ui";

/** Buttons above a printable receipt / statement batch. `target` says what "mark" records. */
export function ReceiptPrintActions({
  target,
  canMark = true,
}: {
  target: { kind: "gift"; giftId: string } | { kind: "annual"; year: number; contactIds: string[] };
  /** Only bookkeepers can record printed / mailed copies. */
  canMark?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function mark(method: "print" | "mail") {
    setBusy(true);
    setErr(null);
    const r =
      target.kind === "gift"
        ? await markReceiptAction(target.giftId, method)
        : await markAnnualAction(target.year, target.contactIds, method);
    setBusy(false);
    if (r.ok) {
      toast.success(method === "mail" ? "Marked as mailed" : "Marked as printed");
      router.refresh();
    } else setErr(r.error);
  }
  return (
    <div className="print:hidden space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => window.print()} data-testid="print-now">
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </Button>
        {canMark ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => mark("mail")} disabled={busy} data-testid="mark-mailed">
              {target.kind === "annual" ? "Mark all as mailed" : "Mark as mailed"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => mark("print")} disabled={busy} data-testid="mark-printed">
              {target.kind === "annual" ? "Mark all as printed" : "Mark as printed"}
            </Button>
          </>
        ) : null}
      </div>
      {err ? <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">{err}</p> : null}
    </div>
  );
}
