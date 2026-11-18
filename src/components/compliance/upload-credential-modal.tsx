"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import {
  createProofUploadUrlAction,
  submitCredentialAction,
} from "@/app/(portal)/volunteer/credentials/actions";

export interface DefinitionOption {
  id: string;
  name: string;
  defaultValidityMonths: number;
}

type Step = "idle" | "preparing" | "uploading" | "saving";
type Errors = Partial<
  Record<"definitionId" | "issuerPartner" | "referenceNumber" | "issuedAt" | "expiresAt" | "file", string>
>;

const ISSUER_SUGGESTIONS = [
  "Cal Ripken / First Advantage",
  "Babe Ruth / First Advantage",
  "USA Wrestling",
  "NCSI",
  "SafeSport",
  "NFHS / CDC Heads Up",
  "GBYS",
];

const SSN_LIKE = /^\d{3}[-\s]?\d{2}[-\s]?\d{4}$/;

export function UploadCredentialModal({
  definitions,
  allowedTypes,
  maxBytes,
}: {
  definitions: DefinitionOption[];
  allowedTypes: string[];
  maxBytes: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Upload credential
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Upload a credential"
        description="Submit your confirmation number and a screenshot or PDF of the receipt. Never include your SSN or the full report."
        footer={null}
      >
        <UploadForm
          definitions={definitions}
          allowedTypes={allowedTypes}
          maxBytes={maxBytes}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

function UploadForm({
  definitions,
  allowedTypes,
  maxBytes,
  onDone,
}: {
  definitions: DefinitionOption[];
  allowedTypes: string[];
  maxBytes: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const busy = step !== "idle";
  const today = utcToLaDateInput(new Date());

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const definitionId = String(fd.get("definitionId") ?? "");
    const issuerPartner = String(fd.get("issuerPartner") ?? "").trim();
    const referenceNumber = String(fd.get("referenceNumber") ?? "").trim();
    const issued = String(fd.get("issuedAt") ?? "");
    const expires = String(fd.get("expiresAt") ?? "");
    const file = fd.get("file");

    const errs: Errors = {};
    if (!definitionId) errs.definitionId = "Choose a credential type.";
    if (!issuerPartner) errs.issuerPartner = "Issuer is required.";
    if (!referenceNumber) errs.referenceNumber = "Reference number is required.";
    else if (SSN_LIKE.test(referenceNumber))
      errs.referenceNumber = "That looks like an SSN. Enter only the confirmation/reference number.";
    if (!issued) errs.issuedAt = "Issue date is required.";
    else if (issued > today) errs.issuedAt = "Issue date cannot be in the future.";
    if (expires && issued && expires <= issued) errs.expiresAt = "Expiration must be after the issue date.";
    if (!(file instanceof File) || file.size === 0) errs.file = "Choose a proof file.";
    else if (!allowedTypes.includes(file.type)) errs.file = "Unsupported file type. Use PDF, PNG, JPEG, WebP or HEIC.";
    else if (file.size > maxBytes) errs.file = `File is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`;
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length > 0 || !(file instanceof File)) return;

    try {
      setStep("preparing");
      const presign = await createProofUploadUrlAction({
        definitionId,
        fileName: file.name,
        contentType: file.type as never,
        size: file.size,
      });
      if (!presign.ok) return fail(presign.error);

      setStep("uploading");
      let putRes: Response;
      try {
        putRes = await fetch(presign.data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
      } catch {
        return fail(
          "Could not upload your file. Check your connection and try again. Nothing was submitted.",
        );
      }
      if (!putRes.ok) {
        return fail(`File upload failed (error ${putRes.status}). Nothing was submitted, so please try again.`);
      }

      setStep("saving");
      const saved = await submitCredentialAction({
        definitionId,
        issuerPartner,
        referenceNumber,
        issuedAt: laDateInputToUtc(issued).toISOString(),
        expiresAt: expires ? laDateInputToUtc(expires).toISOString() : undefined,
        proofObjectKey: presign.data.objectKey,
      });
      if (!saved.ok) return fail(saved.error);

      toast.success("Credential submitted", "The board will review it shortly.");
      router.refresh();
      onDone();
    } catch {
      fail("Something went wrong. Please try again.");
    }
  }

  function fail(message: string) {
    setFormError(message);
    setStep("idle");
  }

  const stepLabel =
    step === "preparing" ? "Preparing..." : step === "uploading" ? "Uploading file..." : step === "saving" ? "Saving..." : "Submit for review";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-busy={busy}>
      <Field label="Credential" error={errors.definitionId}>
        <Select name="definitionId" defaultValue="" disabled={busy}>
          <option value="" disabled>
            Select a credential...
          </option>
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Issuer / partner" error={errors.issuerPartner} hint="e.g. Cal Ripken / First Advantage">
        <Input name="issuerPartner" list="issuer-suggestions" maxLength={120} disabled={busy} autoComplete="off" />
      </Field>
      <datalist id="issuer-suggestions">
        {ISSUER_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Field label="Reference / confirmation number" error={errors.referenceNumber} hint="Do not enter an SSN.">
        <Input name="referenceNumber" maxLength={100} disabled={busy} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Issue date" error={errors.issuedAt}>
          <Input type="date" name="issuedAt" max={today} disabled={busy} />
        </Field>
        <Field label="Expiration date (optional)" error={errors.expiresAt} hint="Defaults from the credential type.">
          <Input type="date" name="expiresAt" disabled={busy} />
        </Field>
      </div>
      <Field
        label="Proof of completion"
        error={errors.file}
        hint={`PDF, PNG, JPEG, WebP or HEIC, up to ${Math.round(maxBytes / 1024 / 1024)} MB.`}
      >
        <Input type="file" name="file" accept={allowedTypes.join(",")} disabled={busy} className="file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-1 file:text-xs file:font-semibold" />
      </Field>

      {formError ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-sm font-medium text-rose-900">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2.5 pt-2">
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {stepLabel}
        </Button>
      </div>
    </form>
  );
}
