import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RegisterStepper } from "@/components/registration/register-stepper";
import { closesLabel, eligibilityLabel, feeLabel, seasonDatesLabel } from "@/components/registration/format";
import { Badge, buttonStyles, Card, EmptyState } from "@/components/ui";
import { getSessionContext } from "@/lib/dal/context";
import { getRegistrationPage } from "@/lib/dal/registrations";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getRegistrationPage(null, slug);
  return { title: page ? `Register: ${page.program.name}` : "Registration" };
}

/** Public. Signed-out visitors see the program summary only; no household data is loaded without a session. */
export default async function RegisterPage({ params }: { params: Params }) {
  const { slug } = await params;
  const ctx = await getSessionContext();
  const page = await getRegistrationPage(ctx, slug);
  if (!page) notFound();
  const { program, seasons } = page;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-10 pt-4 sm:px-8">
      <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-charcoal">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All programs
      </Link>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{program.sport}</p>
        <h1 className="mt-1 break-words text-3xl font-bold tracking-tight text-charcoal">{program.name}</h1>
        {program.description ? (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-stone-600">{program.description}</p>
        ) : null}
      </header>

      {seasons.length === 0 ? (
        <EmptyState
          title="Registration is not open right now"
          description="There are no open seasons for this program. Check back soon."
          action={
            <Link href="/" className={buttonStyles({ variant: "secondary", size: "sm" })}>
              See other programs
            </Link>
          }
        />
      ) : (
        <>
          <section aria-label="Open seasons" className="grid gap-4 sm:grid-cols-2">
            {seasons.map((s) => {
              const elig = eligibilityLabel(s.eligibleBirthDateFrom, s.eligibleBirthDateTo);
              const dates = seasonDatesLabel(s.startsOn, s.endsOn);
              return (
                <Card key={s.seasonId} className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 break-words text-base font-bold text-charcoal">{s.name}</h2>
                    <Badge tone={s.feeCents === 0 ? "success" : "info"}>{feeLabel(s.feeCents)}</Badge>
                  </div>
                  {s.description ? <p className="text-xs leading-relaxed text-stone-500">{s.description}</p> : null}
                  <ul className="space-y-0.5 text-xs text-stone-500">
                    {dates ? <li>{dates}</li> : null}
                    {elig ? <li>{elig}</li> : null}
                    <li className="font-medium text-stone-600">{closesLabel(s.closesAt)}</li>
                  </ul>
                </Card>
              );
            })}
          </section>

          {ctx ? (
            <RegisterStepper seasons={seasons} />
          ) : (
            <Card className="flex flex-col items-start gap-3">
              <h2 className="text-lg font-bold text-charcoal">Ready to register?</h2>
              <p className="text-sm text-stone-600">
                Sign in to choose your athlete, answer a few questions and sign the waiver. It only takes a couple of
                minutes.
              </p>
              <Link href={`/sign-in?next=${encodeURIComponent(`/register/${program.slug}`)}`} className={buttonStyles()}>
                Sign in to register
              </Link>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
