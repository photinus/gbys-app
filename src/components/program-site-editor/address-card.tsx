"use client";

import { useEffect, useRef, useState } from "react";
import { checkPathAction, saveAddressAction, saveDomainAction } from "@/app/(portal)/programs/[slug]/home-page/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Switch, useToast } from "@/components/ui";

type Hint = { status: "idle" | "checking" | "empty" | "available" | "yours" | "taken" | "invalid"; message: string };

export function AddressForm({
  programId,
  appHost,
  pathSlug,
  listOnMainSite,
}: {
  programId: string;
  appHost: string;
  pathSlug: string | null;
  listOnMainSite: boolean;
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(saveAddressAction);
  const [path, setPath] = useState(pathSlug ?? "");
  const [hint, setHint] = useState<Hint>({ status: "idle", message: "" });
  const seq = useRef(0);

  useEffect(() => {
    if (state?.ok) {
      const d = state.data as { pathSlug: string | null; changed: string[] };
      toast.success(d.changed.length ? "Address & visibility saved" : "No changes to save");
      setPath(d.pathSlug ?? "");
    }
  }, [state, toast]);

  useEffect(() => {
    const mine = ++seq.current;
    if (path.trim() === "") {
      setHint({ status: "empty", message: "No address yet. You need one (or a custom domain) to publish." });
      return;
    }
    setHint({ status: "checking", message: "Checking..." });
    const t = setTimeout(async () => {
      const res = await checkPathAction(programId, path);
      if (mine !== seq.current) return;
      if (res.ok) setHint({ status: res.data.status, message: res.data.message });
      else setHint({ status: "invalid", message: res.error });
    }, 350);
    return () => clearTimeout(t);
  }, [path, programId]);

  const bad = hint.status === "invalid" || hint.status === "taken";
  const good = hint.status === "available" || hint.status === "yours";
  const preview = path.trim().toLowerCase().replace(/^\/+|\/+$/g, "");

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm" data-testid="address-form">
      <input type="hidden" name="programId" value={programId} />
      <Field label="Web address on the GBYS site" hint="Letters, numbers and dashes. Capital letters are changed to lowercase.">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs text-stone-500" aria-hidden>
            {appHost}/
          </span>
          <Input
            name="pathSlug"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            maxLength={64}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="basketball-registration"
            data-testid="path-input"
            aria-invalid={bad ? true : undefined}
          />
        </div>
      </Field>
      <p
        role="status"
        data-testid="path-hint"
        data-status={hint.status}
        className={`-mt-2 text-xs font-medium ${bad ? "text-rose-700" : good ? "text-emerald-800" : "text-stone-500"}`}
      >
        {preview && good ? `${appHost}/${preview}: ` : ""}
        {hint.message}
      </p>

      <div className="rounded-2xl bg-alabaster px-4 py-3">
        <label className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-charcoal">List on the main GBYS site</span>
            <span className="block text-xs text-stone-500">
              On: this program&apos;s open registrations appear on the GBYS home page and in families&apos; “Open for your
              family” suggestions. Off: they only appear on this program&apos;s own home page (or with a direct
              registration link). Either way, people with the registration link can still sign up.
            </span>
          </span>
          <Switch name="listOnMainSite" defaultChecked={listOnMainSite} aria-label="List on the main GBYS site" data-testid="list-toggle" />
        </label>
      </div>

      <FormError state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || bad} data-testid="save-address">
          {pending ? "Saving..." : "Save address & visibility"}
        </Button>
      </div>
    </form>
  );
}

export function DomainForm({
  programId,
  customDomain,
  canSetDomain,
  appHost,
}: {
  programId: string;
  customDomain: string | null;
  canSetDomain: boolean;
  appHost: string;
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(saveDomainAction);
  const [value, setValue] = useState(customDomain ?? "");
  useEffect(() => {
    if (state?.ok) {
      const d = state.data as { customDomain: string | null; changed: string[] };
      toast.success(d.changed.length ? "Custom domain saved" : "No changes to save");
      setValue(d.customDomain ?? "");
    }
  }, [state, toast]);

  if (!canSetDomain) {
    return (
      <div className="space-y-2 text-sm" data-testid="domain-readonly">
        <p className="text-stone-700">
          {customDomain ? (
            <>
              Custom domain: <span className="font-semibold text-charcoal">{customDomain}</span>
            </>
          ) : (
            "No custom domain is connected."
          )}
        </p>
        <p className="text-xs text-stone-500">
          A custom domain (like ripkenbaseball.org) needs DNS and hosting changes, so a GBYS board member sets it up. Ask a
          board member if you&apos;d like one.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm" data-testid="domain-form">
      <input type="hidden" name="programId" value={programId} />
      <Field label="Custom domain" hint="Just the domain, like ripkenbaseball.org. Leave blank to remove it.">
        <Input
          name="customDomain"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={253}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder="ripkenbaseball.org"
          data-testid="domain-input"
        />
      </Field>

      <div className="space-y-2 rounded-2xl bg-alabaster px-4 py-3 text-xs text-stone-600" data-testid="dns-steps">
        <p className="text-sm font-semibold text-charcoal">How to connect the domain</p>
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>
            In Railway, open the web service, then <span className="font-semibold">Settings, Networking, Custom Domain</span>,
            and add the domain exactly as typed above.
          </li>
          <li>
            Railway shows a CNAME record. At the company that manages the domain&apos;s DNS, create that record. (For a bare
            domain like <span className="font-mono">example.org</span> you need a provider that supports CNAME flattening or
            ALIAS records; otherwise use a <span className="font-mono">www.</span> name.)
          </li>
          <li>Wait for DNS and the security certificate. This can take from a few minutes to a few hours; Railway shows when it&apos;s ready.</li>
          <li>
            Save the domain here, then publish the page. <span className="font-mono">www.</span> is a separate domain: add it
            in Railway too and as its own entry if you want both to work.
          </li>
        </ol>
        <p>
          On a custom domain only the home page is shown. Register, Sign in and Contact links go to{" "}
          <span className="font-semibold">{appHost}</span>.
        </p>
      </div>

      <FormError state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} data-testid="save-domain">
          {pending ? "Saving..." : "Save domain"}
        </Button>
      </div>
    </form>
  );
}
