import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { IS_MACOS } from "../lib/platform";
import { useTranslation } from "react-i18next";
import { Button } from "./ui";

interface DetailSheetProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function DetailSheet({
  open,
  title,
  description,
  meta,
  actions,
  onClose,
  children,
}: DetailSheetProps) {
  const { t } = useTranslation();
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    // Native PageUp/PageDown/arrow keys should scroll the opened document,
    // rather than the page underneath it.
    scrollRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const rect = sheet.getBoundingClientRect();
      // Leave Escape to any dialog covering the detail sheet.
      const topElement = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (!topElement || !sheet.contains(topElement)) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div ref={sheetRef} className="fixed top-[28px] right-0 bottom-0 left-[220px] z-40 isolate">
      <div
        className={
          IS_MACOS
            ? "absolute inset-0 z-0 bg-black/65"
            : "absolute inset-0 z-0 bg-black/60 backdrop-blur-sm"
        }
        onClick={onClose}
      />
      <div className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden border-l border-border-subtle bg-bg-secondary">
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface px-5 py-2">
          <div className="min-w-0"><p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">Skill · {t("ui.document")}</p><h2 id={titleId} className="truncate text-[17px] font-semibold tracking-tight text-primary">{title}</h2></div>
          <div className="flex shrink-0 items-center gap-2">{actions}<Button variant="ghost" onClick={onClose} aria-label={t("ui.back")}><X className="h-4 w-4" /></Button></div>
        </header>
        <div ref={scrollRef} tabIndex={0} role="region" aria-labelledby={titleId} className="app-scroll-region flex-1 px-5 pb-6 pt-3">
          {description ? (
            <div className="text-[15px] leading-7 text-secondary">{description}</div>
          ) : null}
          {meta ? <div className="mx-auto mb-3 max-w-[1100px]">{meta}</div> : null}
          <div className="mx-auto max-w-[1100px]">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}
