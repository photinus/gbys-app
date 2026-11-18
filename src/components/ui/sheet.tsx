"use client";

import { X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useDialog } from "./use-dialog";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Right-hand slide-over built on native <dialog>. */
export function Sheet({ open, onClose, title, subtitle, children, footer }: SheetProps) {
  const ref = useDialog(open, onClose);

  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      onClick={onClick}
      className="gbys-sheet m-0 ml-auto h-dvh max-h-dvh w-full max-w-md overflow-hidden bg-white p-0 text-charcoal shadow-2xl border-l border-line backdrop:bg-charcoal/30 backdrop:backdrop-blur-[2px]"
    >
      {open ? (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line-soft p-6">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-charcoal">{title}</h3>
              {subtitle ? <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-alabaster text-stone-600 hover:bg-stone-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 space-y-6 overflow-y-auto p-6">{children}</div>
          {footer ? (
            <div className="flex items-center gap-3 border-t border-line-soft bg-alabaster/50 p-5">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
