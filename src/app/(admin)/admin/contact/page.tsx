import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InboxView } from "@/components/contact-admin/views";
import { isBoard, requireSession } from "@/lib/dal/context";

export const metadata: Metadata = { title: "Contact inbox" };
export const dynamic = "force-dynamic";

export default async function AdminContactInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/admin/contact");
  if (!isBoard(ctx)) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Contact</h1>
        <p className="mt-1 text-sm text-stone-500">Messages from every public contact form, across all programs.</p>
      </div>
      <InboxView ctx={ctx} scope={{ all: true }} basePath="/admin/contact" searchParams={await searchParams} />
    </div>
  );
}
