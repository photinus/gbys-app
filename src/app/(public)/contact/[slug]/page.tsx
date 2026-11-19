import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactForm } from "@/components/contact-public/contact-form";
import { FormUnavailable } from "@/components/contact-public/unavailable";
import { getPublicContactForm } from "@/lib/dal/contact-submit";
import { getTurnstileConfig } from "@/lib/turnstile";
import { submitContactAction } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const form = await getPublicContactForm((await params).slug);
  return { title: form?.title ?? "Contact us" };
}

export default async function ContactPage({ params }: { params: Promise<{ slug: string }> }) {
  const form = await getPublicContactForm((await params).slug);
  if (!form) notFound();
  const turnstile = getTurnstileConfig();
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-10 pt-4 sm:px-8 sm:pt-8">
      <div className="rounded-[26px] border border-line/80 bg-white p-5 shadow-card sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-charcoal">{form.title}</h1>
        {form.intro ? <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-stone-600">{form.intro}</p> : null}
        <div className="mt-6">
          {turnstile.enabled ? (
            <ContactForm
              action={submitContactAction}
              slug={form.slug}
              siteKey={turnstile.siteKey}
              collectPhone={form.collectPhone}
              phoneRequired={form.phoneRequired}
              fields={form.fields}
              submitLabel={form.submitLabel}
              successMessage={form.successMessage}
              privacyNote={form.privacyNote}
            />
          ) : (
            <FormUnavailable />
          )}
        </div>
      </div>
    </main>
  );
}
