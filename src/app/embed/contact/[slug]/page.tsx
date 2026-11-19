import { notFound } from "next/navigation";
import { ContactForm } from "@/components/contact-public/contact-form";
import { EmbedResizer } from "@/components/contact-public/embed-resizer";
import { FormUnavailable } from "@/components/contact-public/unavailable";
import { getPublicContactForm } from "@/lib/dal/contact-submit";
import { getTurnstileConfig } from "@/lib/turnstile";
import { submitContactAction } from "@/app/(public)/contact/[slug]/actions";

export const dynamic = "force-dynamic";

export default async function EmbedContactPage({ params }: { params: Promise<{ slug: string }> }) {
  const form = await getPublicContactForm((await params).slug);
  if (!form) notFound();
  const turnstile = getTurnstileConfig();
  return (
    <EmbedResizer>
      <div className="p-3 sm:p-4">
        <h1 className="text-lg font-bold tracking-tight text-charcoal">{form.title}</h1>
        {form.intro ? <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-stone-600">{form.intro}</p> : null}
        <div className="mt-4">
          {turnstile.enabled ? (
            <ContactForm
              compact
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
            <FormUnavailable compact />
          )}
        </div>
      </div>
    </EmbedResizer>
  );
}
