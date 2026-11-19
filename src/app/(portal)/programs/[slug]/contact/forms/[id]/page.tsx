import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactFormEditor } from "@/components/contact-admin/form-editor";
import { contactEmbedConfig } from "@/components/contact-admin/embed-config";
import { DalError, requireSession } from "@/lib/dal/context";
import { getContactForm, getProgramForContact } from "@/lib/dal/contact-forms";

export const metadata: Metadata = { title: "Edit contact form" };
export const dynamic = "force-dynamic";

export default async function ProgramEditContactFormPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await requireSession(`/programs/${slug}/contact/forms/${id}`);
  let program, form;
  try {
    program = await getProgramForContact(ctx, slug);
    form = await getContactForm(ctx, id);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  // The form must belong to the program in the URL.
  if (form.programId !== program.id) notFound();
  const base = `/programs/${program.slug}/contact`;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Link href={`${base}/forms`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          {program.name} contact forms
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">{form.title}</h1>
      </div>
      <ContactFormEditor key={form.updatedAt.getTime()} basePath={base} form={form} {...contactEmbedConfig()} />
    </div>
  );
}
