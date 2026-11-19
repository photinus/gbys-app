import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactFormEditor } from "@/components/contact-admin/form-editor";
import { contactEmbedConfig } from "@/components/contact-admin/embed-config";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import { getContactForm } from "@/lib/dal/contact-forms";

export const metadata: Metadata = { title: "Edit contact form" };
export const dynamic = "force-dynamic";

export default async function AdminEditContactFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/admin/contact/forms/${id}`);
  if (!isBoard(ctx)) notFound();
  let form;
  try {
    form = await getContactForm(ctx, id);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Link href="/admin/contact/forms" className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          Contact forms
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">{form.title}</h1>
      </div>
      <ContactFormEditor basePath="/admin/contact" form={form} {...contactEmbedConfig()} />
    </div>
  );
}
