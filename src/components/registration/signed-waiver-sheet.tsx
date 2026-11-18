"use client";

import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchSignedWaiverAction } from "@/app/(portal)/registrations/actions";
import { Badge, Sheet } from "@/components/ui";
import type { SignedWaiverView } from "@/lib/dal/registrations";
import { formatDateTime } from "@/lib/format";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: SignedWaiverView };

/** Read-only sheet showing the exact waiver text a guardian signed. */
export function SignedWaiverSheet({ registrationId, onClose }: { registrationId: string | null; onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!registrationId) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchSignedWaiverAction(registrationId).then((res) => {
      if (cancelled) return;
      setState(res.ok ? { status: "ready", data: res.data } : { status: "error", message: res.error });
    });
    return () => {
      cancelled = true;
    };
  }, [registrationId]);

  const d = state.status === "ready" ? state.data : null;
  return (
    <Sheet
      open={registrationId !== null}
      onClose={onClose}
      title={d ? d.title : "Signed waiver"}
      subtitle={d ? `${d.athleteName} - ${d.programName}, ${d.seasonName}` : undefined}
    >
      {state.status === "loading" ? <p className="text-sm text-stone-500">Loading...</p> : null}
      {state.status === "error" ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {state.message}
        </p>
      ) : null}
      {d ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div>
              <dt className="text-stone-400">Version</dt>
              <dd className="mt-0.5 font-semibold text-charcoal">{d.version}</dd>
            </div>
            <div>
              <dt className="text-stone-400">Signed</dt>
              <dd className="mt-0.5 font-semibold text-charcoal">{formatDateTime(d.signedAt)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-stone-400">Signature</dt>
              <dd className="mt-0.5 break-words font-semibold text-charcoal">{d.signatureName}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-stone-400">Signed by account</dt>
              <dd className="mt-0.5 break-words font-semibold text-charcoal">{d.signedByName}</dd>
            </div>
            {d.ipAddress ? (
              <div className="min-w-0">
                <dt className="text-stone-400">IP address</dt>
                <dd className="mt-0.5 break-all font-semibold text-charcoal">{d.ipAddress}</dd>
              </div>
            ) : null}
          </dl>
          <div className="flex items-center gap-2">
            {d.hashMatches ? (
              <Badge tone="success">
                <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden /> Text matches signed record
              </Badge>
            ) : (
              <Badge tone="danger">
                <TriangleAlert className="mr-1 h-3.5 w-3.5" aria-hidden /> Text does not match signed record
              </Badge>
            )}
          </div>
          <div>
            <h4 className="mb-1.5 text-xs font-semibold text-stone-600">Waiver text</h4>
            <div
              tabIndex={0}
              role="region"
              aria-label="Signed waiver text"
              className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-line bg-alabaster p-4 text-xs leading-relaxed text-stone-700 focus:outline-none focus:ring-2 focus:ring-periwinkle"
            >
              {d.body}
            </div>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-semibold text-stone-600">Fingerprint (SHA-256)</h4>
            <p className="break-all font-mono text-[11px] text-stone-500">{d.storedHash}</p>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
