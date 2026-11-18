"use client";

import { X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useDialog } from "./use-dialog";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  const ref = useDialog(open, onClose);

  // Click on the backdrop (the dialog element itself) closes.
  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      onClick={onClick}
      className="gbys-modal m-auto w-full max-w-lg max-h-[90vh] overflow-hidden rounded-[28px] bg-white p-0 text-charcoal shadow-2xl border border-line backdrop:bg-charcoal/40 backdrop:backdrop-blur-[2px]"
    >
      {open ? (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line-soft px-6 pt-6 pb-4 sm:px-7">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-charcoal">{title}</h3>
              {description ? <p className="mt-0.5 text-xs text-stone-500">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-alabaster text-stone-500 hover:text-charcoal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5 sm:px-7">{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2.5 border-t border-line-soft px-6 py-4 sm:px-7">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
