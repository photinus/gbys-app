"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { createContactFormAction, updateContactFormAction } from "@/app/(admin)/admin/contact/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { FormBuilder, toBuilderFields, toDefinition, type BuilderField } from "@/components/seasons/form-builder";
import { FormPreview } from "@/components/seasons/form-preview";
import { Button, Card, CardHeader, Field, Input, Select, Switch, Textarea, buttonStyles, useToast } from "@/components/ui";
import type { ContactFormDetail } from "@/lib/dal/contact-forms";
import { CONTACT_MAX_FIELDS, suggestSlug } from "@/lib/validation/contact-forms";
import Link from "next/link";
import { EmbedPanel } from "./embed-panel";
import { RecipientsInput } from "./recipients-input";

export interface EditorProps {
  /** Contact section root, e.g. "/admin/contact" or "/programs/spring-soccer/contact". */
  basePath: string;
  form?: ContactFormDetail;
  /** Fixed program for program-scoped create. Ignored when editing. */
  program?: { id: string; name: string } | null;
  /** Board create from /admin/contact: pick org-wide or a program. */
  programOptions?: { id: string; name: string }[];
  appUrl: string;
  allowedOrigins: string[];
}

export function ContactFormEditor({ basePath, form, program, programOptions, appUrl, allowedOrigins }: EditorProps) {
  const toast = useToast();
  const router = useRouter();
  const isEdit = !!form;
  const { state: createState, pending: createPending, onSubmit: createSubmit } = useActionForm(createContactFormAction);
  const { state: updState, pending: updPending, onSubmit: updSubmit } = useActionForm(updateContactFormAction);
  const state = isEdit ? updState : createState;
  const pending = isEdit ? updPending : createPending;
  const onSubmit = isEdit ? updSubmit : createSubmit;

  const [programId, setProgramId] = useState<string>(form ? (form.programId ?? "") : (program?.id ?? ""));
  const [title, setTitle] = useState(form?.title ?? "");
  const [slug, setSlug] = useState(form?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [collectPhone, setCollectPhone] = useState(form?.collectPhone ?? false);
  const [phoneRequired, setPhoneRequired] = useState(form?.phoneRequired ?? false);
  const [fields, setFields] = useState<BuilderField[]>(() => toBuilderFields(form?.fields ?? []));
  const [recipients, setRecipients] = useState<string[]>(form?.recipientEmails ?? []);
  const [notify, setNotify] = useState(form?.notifyProgramAdmins ?? true);
  const [isActive, setIsActive] = useState(form?.isActive ?? true);
  const [submitLabel, setSubmitLabel] = useState(form?.submitLabel ?? "Send message");
  const [privacyNote, setPrivacyNote] = useState(form?.privacyNote ?? "");

  const definition = useMemo(() => toDefinition(fields), [fields]);
  const isProgramForm = programId !== "";
  const overCap = fields.length > CONTACT_MAX_FIELDS;
  const programName = form ? form.programName : (program?.name ?? programOptions?.find((p) => p.id === programId)?.name ?? null);

  useEffect(() => {
    if (!state?.ok) return;
    if (isEdit) {
      toast.success("Form saved");
      router.refresh();
    } else {
      toast.success("Form created");
      router.push(`${basePath}/forms/${(state.data as { id: string }).id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const noEnter = (e: KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "submit") e.preventDefault();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
      <form onSubmit={onSubmit} onKeyDown={noEnter} className="min-w-0 space-y-6" data-testid="contact-form-editor">
        {form ? <input type="hidden" name="id" value={form.id} /> : null}
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="fields" value={JSON.stringify(definition)} />
        <input type="hidden" name="recipientEmails" value={JSON.stringify(recipients)} />

        <Card>
          <CardHeader
            title="Details"
            description={programName ? `Form for ${programName}` : isEdit || !programOptions ? "Organization-wide form (board managed)" : "Choose who this form belongs to"}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {!isEdit && programOptions ? (
              <Field label="Belongs to" hint="Can't be changed after the form is created." className="sm:col-span-2">
                <Select value={programId} onChange={(e) => setProgramId(e.target.value)} data-testid="program-select">
                  <option value="">Org-wide (board only)</option>
                  {programOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Form title" className="sm:col-span-2">
              <Input
                name="title"
                required
                maxLength={120}
                value={title}
                placeholder="Contact Gold Beach Soccer"
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugTouched) setSlug(suggestSlug(e.target.value));
                }}
              />
            </Field>
            <Field
              label="URL name"
              hint={`Public link: /contact/${slug || "your-name"}. Changing it later breaks links and embeds already shared.`}
              className="sm:col-span-2"
            >
              <Input
                name="slug"
                required
                minLength={3}
                maxLength={60}
                value={slug}
                className="font-mono text-xs"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
            </Field>
            <Field label="Intro (optional)" hint="Plain text shown above the form." className="sm:col-span-2">
              <Textarea name="intro" rows={3} maxLength={1000} defaultValue={form?.intro ?? ""} />
            </Field>
            <label className="flex items-center gap-2.5 text-sm font-medium text-charcoal sm:col-span-2">
              <Switch name="isActive" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Form is active (accepting messages)
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader title="Questions" description="Name, email and message are always included. Add up to 15 more questions." />
          <div className="mb-5 grid gap-3 rounded-2xl bg-alabaster/70 p-4 sm:grid-cols-2">
            <label className="flex items-center gap-2.5 text-sm font-medium text-charcoal">
              <Switch
                name="collectPhone"
                checked={collectPhone}
                onChange={(e) => {
                  setCollectPhone(e.target.checked);
                  if (!e.target.checked) setPhoneRequired(false);
                }}
              />
              Ask for a phone number
            </label>
            <label className="flex items-center gap-2.5 text-sm font-medium text-charcoal">
              <Switch name="phoneRequired" checked={phoneRequired} disabled={!collectPhone} onChange={(e) => setPhoneRequired(e.target.checked)} />
              Phone is required
            </label>
          </div>
          <FormBuilder fields={fields} onChange={setFields} lockedKeys={new Set()} maxFields={CONTACT_MAX_FIELDS} />
          {overCap ? (
            <p role="alert" data-testid="cap-warning" className="mt-3 rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
              A contact form can have at most {CONTACT_MAX_FIELDS} extra questions. Remove {fields.length - CONTACT_MAX_FIELDS} to save.
            </p>
          ) : (
            <p className="mt-2 text-xs text-stone-400">Contact forms are limited to {CONTACT_MAX_FIELDS} extra questions.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Where messages go" description="Every message is saved in the inbox and also emailed. The sender never gets an automatic reply." />
          <div className="space-y-4">
            <RecipientsInput value={recipients} onChange={setRecipients} />
            {isProgramForm ? (
              <label className="flex items-center gap-2.5 text-sm font-medium text-charcoal">
                <Switch name="notifyProgramAdmins" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Also email the program&apos;s admins
              </label>
            ) : (
              <p className="text-xs text-stone-500">Org-wide forms need at least one recipient address.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Wording" />
          <div className="grid gap-4">
            <Field label="Submit button label">
              <Input name="submitLabel" required maxLength={40} value={submitLabel} onChange={(e) => setSubmitLabel(e.target.value)} />
            </Field>
            <Field label="Thank-you message" hint="Shown after a successful submission.">
              <Textarea name="successMessage" required rows={2} maxLength={500} defaultValue={form?.successMessage ?? "Thanks! We'll get back to you soon."} />
            </Field>
            <Field label="Privacy note (optional)" hint="Small print under the form, e.g. how messages are used.">
              <Textarea name="privacyNote" rows={2} maxLength={500} value={privacyNote} onChange={(e) => setPrivacyNote(e.target.value)} />
            </Field>
          </div>
        </Card>

        <FormError state={state} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || overCap} data-testid="save-form">
            {pending ? "Saving..." : isEdit ? "Save changes" : "Create form"}
          </Button>
          <Link href={`${basePath}/forms`} className={buttonStyles({ variant: "ghost" })}>
            {isEdit ? "Back to forms" : "Cancel"}
          </Link>
        </div>
      </form>

      <div className="min-w-0 space-y-6 lg:sticky lg:top-6">
        <Card data-testid="live-preview">
          <CardHeader title="Preview" description="How visitors will see the form" />
          <div className="space-y-4" onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA" && e.preventDefault()}>
            <p className="text-base font-bold text-charcoal">{title || <span className="text-stone-400">Untitled form</span>}</p>
            <Field label="Your name">
              <Input placeholder="" />
            </Field>
            <Field label="Email">
              <Input type="email" />
            </Field>
            {collectPhone ? (
              <Field label={<>Phone{phoneRequired ? <span className="text-rose-600"> *</span> : <span className="text-stone-400"> (optional)</span>}</>}>
                <Input type="tel" />
              </Field>
            ) : null}
            {fields.length ? <FormPreview fields={definition} /> : null}
            <Field label="Message">
              <Textarea rows={4} />
            </Field>
            <button type="button" tabIndex={-1} className={buttonStyles({ className: "w-full" })}>
              {submitLabel || "Send message"}
            </button>
            {privacyNote.trim() ? <p className="text-xs text-stone-500">{privacyNote}</p> : null}
          </div>
        </Card>
        {isEdit && form ? (
          <EmbedPanel appUrl={appUrl} slug={slug} title={title} savedSlug={form.slug} isActive={isActive} allowedOrigins={allowedOrigins} />
        ) : (
          <Card>
            <CardHeader title="Share and embed" />
            <p className="text-xs text-stone-500">Create the form first. You&apos;ll get the hosted link and an embed code here.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
