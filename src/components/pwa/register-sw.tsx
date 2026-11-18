"use client";

import { Check, CloudOff, Loader2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { EMERGENCY_CACHE } from "@/lib/pwa";
import { formatDateTime } from "@/lib/format";

const CACHED_AT_HEADER = "x-gbys-cached-at";

async function readCachedAt(): Promise<number | null> {
  try {
    if (typeof caches === "undefined") return null;
    const cache = await caches.open(EMERGENCY_CACHE);
    const res = await cache.match(new Request(location.origin + location.pathname.replace(/\/$/, "")));
    const at = Number(res?.headers.get(CACHED_AT_HEADER));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/**
 * Rendered only on the emergency sheet. Registers /sw.js, asks the worker to
 * save this page (client-side navigations do not issue a document request),
 * primes the static assets it needs, and shows online/offline + cache state.
 */
export function RegisterSw() {
  const [online, setOnline] = useState(true);
  const [supported, setSupported] = useState(true);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setSupported(false);
      return;
    }
    let cancelled = false;

    async function save() {
      // The worker only intercepts once it controls this page.
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
          setTimeout(resolve, 4000);
        });
      }
      if (cancelled || !navigator.serviceWorker.controller || !navigator.onLine) return;
      try {
        // A full navigation through the worker was just cached: do not render (and audit) twice.
        const existing = await readCachedAt();
        if (!existing || Date.now() - existing > 60_000) {
          await fetch(location.pathname, {
            headers: { "x-gbys-offline-save": "1", accept: "text/html" },
            credentials: "same-origin",
            cache: "no-store",
          });
        }
        const assets = new Set<string>();
        document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => assets.add(s.src));
        document.querySelectorAll<HTMLLinkElement>("link[href]").forEach((l) => assets.add(l.href));
        await Promise.all(
          [...assets]
            .filter((u) => new URL(u).pathname.startsWith("/_next/static/"))
            .map((u) => fetch(u).catch(() => undefined))
        );
      } catch {
        // offline or blocked: keep whatever is cached
      }
      if (!cancelled) setSavedAt(await readCachedAt());
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then(async () => {
        if (cancelled) return;
        setSavedAt(await readCachedAt());
        await save();
      })
      .catch(() => setSupported(false));

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold" role="status" aria-live="polite">
      <span
        className={
          online
            ? "inline-flex items-center gap-1.5 rounded-full bg-sage/40 px-3 py-1 text-emerald-900"
            : "inline-flex items-center gap-1.5 rounded-full bg-amber-soft/50 px-3 py-1 text-amber-950"
        }
        data-testid="online-status"
      >
        {online ? <Wifi className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
        {online ? "Online" : "Offline: showing saved copy"}
      </span>
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-periwinkle/35 px-3 py-1 text-indigo-950"
        data-testid="offline-saved"
      >
        {!supported ? (
          "Offline copy unavailable on this browser"
        ) : savedAt ? (
          <>
            <Check className="h-3.5 w-3.5" />
            Saved for offline: {formatDateTime(savedAt)}
          </>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Saving for offline...
          </>
        )}
      </span>
    </div>
  );
}
