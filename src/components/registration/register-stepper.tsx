"use client";

import { Check, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { submitRegistrationAction } from "@/app/(public)/register/[slug]/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Badge, Button, buttonStyles, Card, CardHeader, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { buildAnswersSchema } from "@/lib/custom-form";
import type { RegistrationSeason } from "@/lib/dal/registrations";
import { formatDob } from "@/lib/format";
import { normalizeSignatureName, signatureNameSchema } from "@/lib/validation/registration";
import { cn } from "@/lib/utils";
import { closesLabel, eligibilityLabel, feeLabel } from "./format";
import { PayNowButton } from "./pay-now-button";

type Answers = Record<string, string | boolean>;
type StepKey = "choose" | "questions" | "waiver" | "done";
const STEP_LABEL: Record<StepKey, string> = {
  choose: "Athlete",
  questions: "Questions",
  waiver: "Waiver",
  done: "Done",
};

/** Drops empty answers so optional fields are simply absent (and "" never coerces to 0). */
function cleanAnswers(season: RegistrationSeason, answers: Answers): Answers {
  const out: Answers = {};
  for (const f of season.fields) {
    const v = answers[f.key];
    if (f.type === "checkbox") out[f.key] = v === true;
    else if (typeof v === "string" && v !== "") out[f.key] = v;
  }
  return out;
}

export function RegisterStepper({ seasons }: { seasons: RegistrationSeason[] }) {
  const router = useRouter();
  const [seasonId, setSeasonId] = useState(seasons[0]?.seasonId ?? "");
  const [athleteId, setAthleteId] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [stepIdx, setStepIdx] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [signature, setSignature] = useState("");
  const { state, pending, onSubmit } = useActionForm(submitRegistrationAction);

  const season = seasons.find((s) => s.seasonId === seasonId) ?? seasons[0];
  const steps = useMemo<StepKey[]>(
    () => (season.fields.length > 0 ? ["choose", "questions", "waiver", "done"] : ["choose", "waiver", "done"]),
    [season],
  );
  const done = state?.ok === true;
  const step: StepKey = done ? "done" : steps[Math.min(stepIdx, steps.length - 1)];
  const athletes = season.athletes ?? [];
  const athlete = athletes.find((a) => a.id === athleteId);

  function pickSeason(id: string) {
    setSeasonId(id);
    setAthleteId("");
    setAnswers({});
    setStepError(null);
    setStepIdx(0);
  }

  function next() {
    setStepError(null);
    if (step === "choose") {
      if (!athlete || !athlete.eligible) return setStepError("Choose an eligible athlete to continue.");
    } else if (step === "questions") {
      const parsed = buildAnswersSchema(season.fields).safeParse(cleanAnswers(season, answers));
      if (!parsed.success) return setStepError(parsed.error.issues[0]?.message ?? "Check your answers.");
    }
    setStepIdx((i) => i + 1);
  }

  const sigCheck = signatureNameSchema.safeParse(signature);
  const sigError = signature.trim() !== "" && !sigCheck.success ? sigCheck.error.issues[0]?.message : undefined;
  const canSign = agree && sigCheck.success;
  const waiverStale = state && !state.ok && state.error.startsWith("The waiver was updated");

  return (
    <Card>
      <CardHeader
        title="Register"
        description={`${season.program.name} - ${season.name}`}
        action={<Badge tone="info">{feeLabel(season.feeCents)}</Badge>}
      />

      <ol className="mb-6 flex items-center gap-2" aria-label="Registration steps">
        {steps.map((k, i) => {
          const current = k === step;
          const complete = i < steps.indexOf(step) || (done && k !== "done");
          return (
            <li key={k} className="flex min-w-0 flex-1 items-center gap-2" aria-current={current ? "step" : undefined}>
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  current ? "bg-charcoal text-white" : complete ? "bg-sage/50 text-emerald-900" : "bg-stone-100 text-stone-500",
                )}
              >
                {complete ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn("hidden truncate text-xs font-semibold sm:inline", current ? "text-charcoal" : "text-stone-400")}>
                {STEP_LABEL[k]}
              </span>
              {i < steps.length - 1 ? <span className="h-px flex-1 bg-line" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>

      {step === "choose" ? (
        <div className="space-y-5">
          {seasons.length > 1 ? (
            <fieldset>
              <legend className="mb-2 text-xs font-semibold text-stone-600">Season</legend>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {seasons.map((s) => (
                  <label
                    key={s.seasonId}
                    className={cn(
                      "flex cursor-pointer flex-col gap-0.5 rounded-2xl border p-3.5 text-sm",
                      s.seasonId === seasonId ? "border-charcoal bg-alabaster" : "border-line bg-white hover:bg-stone-50",
                    )}
                  >
                    <input
                      type="radio"
                      name="season"
                      className="sr-only"
                      checked={s.seasonId === seasonId}
                      onChange={() => pickSeason(s.seasonId)}
                    />
                    <span className="font-semibold text-charcoal">{s.name}</span>
                    <span className="text-xs text-stone-500">
                      {feeLabel(s.feeCents)} - {closesLabel(s.closesAt)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {eligibilityLabel(season.eligibleBirthDateFrom, season.eligibleBirthDateTo) ? (
            <p className="text-xs text-stone-500">
              Eligibility: {eligibilityLabel(season.eligibleBirthDateFrom, season.eligibleBirthDateTo)}
            </p>
          ) : null}

          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-stone-600">Athlete</legend>
            {athletes.length === 0 ? (
              <EmptyState
                title="No athletes in your household yet"
                description="Add your athlete first, then come back to register."
                action={
                  <Link href="/household" className={buttonStyles({ size: "sm" })}>
                    Add an athlete
                  </Link>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {athletes.map((a) => (
                  <label
                    key={a.id}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border p-3.5 text-sm",
                      a.eligible ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                      a.id === athleteId ? "border-charcoal bg-alabaster" : "border-line bg-white",
                    )}
                  >
                    <input
                      type="radio"
                      name="athlete"
                      disabled={!a.eligible}
                      checked={a.id === athleteId}
                      onChange={() => setAthleteId(a.id)}
                      className="h-4 w-4 accent-charcoal"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-charcoal">{a.name}</span>
                      <span className="block text-xs text-stone-500">Born {formatDob(a.dateOfBirth)}</span>
                      {a.reason ? <span className="mt-0.5 block text-xs font-medium text-rose-700">{a.reason}</span> : null}
                    </span>
                  </label>
                ))}
                <p className="pt-1 text-xs text-stone-500">
                  Not listed?{" "}
                  <Link href="/household" className="font-semibold text-charcoal underline">
                    Add an athlete in your household
                  </Link>
                  .
                </p>
              </div>
            )}
          </fieldset>
        </div>
      ) : null}

      {step === "questions" ? (
        <div className="space-y-4">
          {season.fields.map((f) => {
            const v = answers[f.key];
            const set = (val: string | boolean) => setAnswers((a) => ({ ...a, [f.key]: val }));
            if (f.type === "checkbox") {
              return (
                <label key={f.key} className="flex items-start gap-3 text-sm text-charcoal">
                  <input
                    type="checkbox"
                    checked={v === true}
                    onChange={(e) => set(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-charcoal"
                  />
                  <span>
                    {f.label}
                    {f.required ? <span className="text-rose-700"> *</span> : null}
                  </span>
                </label>
              );
            }
            const label = (
              <>
                {f.label}
                {f.required ? <span className="text-rose-700"> *</span> : null}
              </>
            );
            return (
              <Field key={f.key} label={label}>
                {f.type === "textarea" ? (
                  <Textarea value={(v as string) ?? ""} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} maxLength={2000} />
                ) : f.type === "select" ? (
                  <Select value={(v as string) ?? ""} onChange={(e) => set(e.target.value)}>
                    <option value="">Choose...</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : f.type === "number" ? (
                  <Input type="number" inputMode="decimal" value={(v as string) ?? ""} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />
                ) : (
                  <Input value={(v as string) ?? ""} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} maxLength={200} />
                )}
              </Field>
            );
          })}
        </div>
      ) : null}

      {step === "waiver" ? (
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="seasonId" value={season.seasonId} />
          <input type="hidden" name="athleteId" value={athleteId} />
          <input type="hidden" name="waiverVersionId" value={season.waiver.id} />
          <input type="hidden" name="answers" value={JSON.stringify(cleanAnswers(season, answers))} />
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-charcoal">{season.waiver.title}</h3>
              <Badge tone="neutral">Version {season.waiver.version}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-stone-500">
              Read the full waiver for {athlete?.name ?? "your athlete"} before signing.
            </p>
            <div
              tabIndex={0}
              role="region"
              aria-label="Waiver text"
              className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-line bg-alabaster p-4 text-xs leading-relaxed text-stone-700 focus:outline-none focus:ring-2 focus:ring-periwinkle"
            >
              {season.waiver.body}
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm text-charcoal">
            <input
              type="checkbox"
              name="agree"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-charcoal"
            />
            <span>I have read and agree to this waiver on behalf of {athlete?.name ?? "my athlete"}.</span>
          </label>
          <Field
            label="Type your full legal name to sign"
            hint="This typed name is your electronic signature."
            error={sigError}
          >
            <Input
              name="signatureName"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              onBlur={() => setSignature(normalizeSignatureName(signature))}
              autoComplete="name"
              maxLength={160}
              required
            />
          </Field>
          <FormError state={state} />
          {waiverStale ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAgree(false);
                router.refresh();
              }}
            >
              Reload the waiver
            </Button>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2.5 pt-1">
            <Button variant="ghost" onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={pending}>
              Back
            </Button>
            <Button type="submit" disabled={pending || !canSign}>
              {pending ? "Submitting..." : "Sign and register"}
            </Button>
          </div>
        </form>
      ) : null}

      {step === "done" && state?.ok ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl bg-mint-card p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sage/50 text-emerald-900">
              <Check className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-charcoal">
                {state.data.athleteName} is registered for {state.data.seasonName}.
              </p>
              <p className="mt-0.5 text-xs text-stone-600">Your signed waiver was saved with the date and time.</p>
            </div>
          </div>
          {state.data.feeCents === 0 ? (
            <p className="text-sm text-stone-700">There is no fee for this season. You are all set.</p>
          ) : (
            <div className="rounded-2xl border border-line bg-alabaster p-4 text-sm text-stone-700">
              <p className="flex items-center gap-2 font-semibold text-charcoal">
                <CircleAlert className="h-4 w-4 text-amber-700" aria-hidden /> Amount due: {feeLabel(state.data.feeCents)}
              </p>
              <p className="mt-1 text-xs leading-relaxed">
                {state.data.canPayOnline
                  ? "Pay now by card on a secure Stripe page, or pay your program by cash or check and a coordinator will record it."
                  : "Pay your program by cash or check; a coordinator will record it."}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-start gap-2.5">
            {state.data.feeCents > 0 && state.data.canPayOnline ? (
              <PayNowButton registrationId={state.data.registrationId} amountCents={state.data.feeCents} size="md" />
            ) : null}
            <Link href="/registrations" className={buttonStyles()}>
              View my registrations
            </Link>
          </div>
        </div>
      ) : null}

      {step === "choose" || step === "questions" ? (
        <>
          {stepError ? (
            <p role="alert" className="mt-4 rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
              {stepError}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-between gap-2.5">
            {step === "questions" ? (
              <Button variant="ghost" onClick={() => setStepIdx((i) => Math.max(0, i - 1))}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={next} disabled={step === "choose" && athletes.length === 0}>
              Continue
            </Button>
          </div>
        </>
      ) : null}
    </Card>
  );
}
