"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth-client";
import { clearSensitiveCaches } from "@/lib/pwa";
import { initials } from "@/lib/utils";
import type { OrgRole } from "./nav";

const ROLE_LABEL: Record<OrgRole, string> = {
  super_admin: "Super admin",
  board_member: "Board member",
  member: "Member",
};

export interface ShellUser {
  name: string;
  email: string;
  image: string | null;
  orgRole: OrgRole;
  /** Shows the "Manage shifts" entry for program admins / coaches / team managers. */
  isShiftCoordinator?: boolean;
  isProgramStaff?: boolean;
  isSeatedDirector?: boolean;
}

export function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleSignOut() {
    setBusy(true);
    try {
      // Purge offline emergency sheets (medical data) before the session ends.
      await clearSensitiveCaches();
      await signOut();
    } finally {
      router.push("/sign-in");
      router.refresh();
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-charcoal text-xs font-bold text-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/60"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          initials(user.name)
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-40 w-64 rounded-2xl border border-line bg-white p-2 shadow-xl"
        >
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-charcoal">{user.name}</p>
            <p className="truncate text-xs text-stone-500">{user.email}</p>
            <span className="mt-2 inline-flex rounded-full bg-lavender-card px-2.5 py-0.5 text-[11px] font-semibold text-indigo-900">
              {ROLE_LABEL[user.orgRole]}
            </span>
          </div>
          <div className="my-1 border-t border-line-soft" />
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={busy}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-stone-700 hover:bg-alabaster disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
