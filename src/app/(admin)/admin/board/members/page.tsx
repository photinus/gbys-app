import type { Metadata } from "next";
import Link from "next/link";
import { MembersManager } from "@/components/board/members-manager";
import { requireSession } from "@/lib/dal/context";
import { listBoardMembers } from "@/lib/dal/board-members";

export const metadata: Metadata = { title: "Board members" };
export const dynamic = "force-dynamic";

export default async function BoardMembersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireSession("/admin/board/members");
  const { show } = await searchParams;
  const showEnded = show === "all";
  const members = await listBoardMembers(ctx, { include: showEnded ? "all" : "current" });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/board" className="text-xs font-semibold text-indigo-700 hover:underline">
          Board of Directors
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Board members</h1>
        <p className="mt-1 text-sm text-stone-500">Seats, terms and who can vote. Seats are ended, never deleted, so past meetings and votes keep their record.</p>
      </div>
      <MembersManager members={members} showEnded={showEnded} />
    </div>
  );
}
