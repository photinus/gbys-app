"use client";

import { AlertCircle, Check } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error";
export type ToastInput = string | { title: string; description?: string; tone?: ToastTone };

export type ToastFn = ((input: ToastInput) => void) & {
  /** Alias of the function itself so `const { toast } = useToast()` works. */
  toast: ToastFn;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
};

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

const ToastContext = createContext<ToastFn | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const o = typeof input === "string" ? { title: input } : input;
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, title: o.title, description: o.description, tone: o.tone ?? "success" }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), o.tone === "error" ? 6000 : 4000),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const api = useMemo(() => {
    const fn = ((input: ToastInput) => push(input)) as ToastFn;
    fn.toast = fn;
    fn.success = (title, description) => push({ title, description, tone: "success" });
    fn.error = (title, description) => push({ title, description, tone: "error" });
    return fn;
  }, [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex max-w-[calc(100vw-2.5rem)] flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-charcoal px-5 py-3.5 text-white shadow-xl"
          >
            <div
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                t.tone === "error" ? "bg-coral/20 text-coral" : "bg-sage/20 text-sage",
              )}
            >
              {t.tone === "error" ? <AlertCircle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description ? <p className="text-xs text-stone-300">{t.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="ml-1 text-stone-400 hover:text-white"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
