import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { InboxView } from "@/components/contact-admin/views";
import { DalError, requireSession } from "@/lib/dal/context";
import { getProgramForContact } from "@/lib/dal/contact-forms";

export const metadata: Metadata = { title: "Contact inbox" };
export const dynamic = "force-dynamic";

export default async function ProgramContactInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const ctx = await requireSession(`/programs/${slug}/contact`);
  let program;
  try {
    program = await getProgramForContact(ctx, slug);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {!program.isActive ? <InactiveProgramBanner /> : null}
      <div className="min-w-0">
        <Link href={`/programs/${program.slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          {program.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">Contact forms</h1>
        <p className="mt-1 text-sm text-stone-500">Messages sent through {program.name}&apos;s contact forms.</p>
      </div>
      <InboxView ctx={ctx} scope={{ programId: program.id }} basePath={`/programs/${program.slug}/contact`} searchParams={await searchParams} />
    </div>
  );
}
