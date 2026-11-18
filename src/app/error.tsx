"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[26px] border border-line/80 bg-white p-8 text-center shadow-card">
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Error</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-stone-500">
          An unexpected error occurred. You can try again, and if it keeps happening let a board member know.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-stone-400">Ref: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex justify-center gap-2.5">
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" onClick={() => (window.location.href = "/")}>
            Home
          </Button>
        </div>
      </div>
    </main>
  );
}
