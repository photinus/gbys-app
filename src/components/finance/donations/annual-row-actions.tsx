"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAnnualAction, sendAnnualAction } from "@/app/(portal)/finance/donations/actions";
import { Button, buttonStyles, useToast } from "@/components/ui";

/** Per-donor yearly statement buttons. */
export function AnnualRowActions({
  contactId,
  year,
  hasEmail,
  sent,
  needs,
}: {
  contactId: string;
  year: number;
  hasEmail: boolean;
  sent: boolean;
  needs: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function email() {
    setBusy(true);
    const r = await sendAnnualAction(contactId, year, sent && !needs);
    setBusy(false);
    if (r.ok) {
      toast.success(`Statement emailed to ${r.data.sentTo}`);
      router.refresh();
    } else toast({ title: r.error, tone: "error" });
  }
  async function mark() {
    setBusy(true);
    const r = await markAnnualAction(year, [contactId], "mail");
    setBusy(false);
    if (r.ok) {
      toast.success("Marked as mailed");
      router.refresh();
    } else toast({ title: r.error, tone: "error" });
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button size="sm" variant={needs ? "primary" : "secondary"} onClick={email} disabled={!hasEmail || busy} title={hasEmail ? undefined : "No email address on file"} data-testid="annual-email">
        <Mail className="h-3.5 w-3.5" /> {sent && !needs ? "Send again" : "Email"}
      </Button>
      <Link href={`/finance/donations/statements/print?year=${year}&donor=${contactId}`} className={buttonStyles({ variant: "secondary", size: "sm" })}>
        Print
      </Link>
      <Button size="sm" variant="ghost" onClick={mark} disabled={busy}>
        Mark mailed
      </Button>
    </div>
  );
}
