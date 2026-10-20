import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Inbox, X } from "lucide-react";
import { cn } from "../../utils";

export function Button({ variant = "secondary", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const variants = { primary: "ui-button-primary", secondary: "ui-button-secondary", ghost: "ui-button-ghost", danger: "ui-button-danger" };
  return <button type={type} className={cn("ui-button", variants[variant], className)} {...props} />;
}
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("app-panel", className)} {...props} />;
}
export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("app-badge", className)} {...props} />;
}
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("app-input", className)} {...props} />;
}
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("app-input app-select", className)} {...props} />;
}
export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (value: T) => void; items: { value: T; label: ReactNode; disabled?: boolean }[]; label: string }) {
  return <div className="app-segmented" role="group" aria-label={label}>
    {items.map(item => <button key={item.value} type="button" disabled={item.disabled} aria-pressed={value === item.value}
      className={cn("app-segmented-button inline-flex items-center gap-1.5", value === item.value && "app-segmented-button-active")}
      onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>;
}
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <header className="app-page-header flex flex-wrap items-center justify-between gap-3">
    <div className="min-w-0"><h1 className="app-page-title">{title}</h1>{description && <p className="app-page-subtitle">{description}</p>}</div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="ui-empty"><Inbox className="h-7 w-7 text-faint" /><h2 className="font-semibold text-primary">{title}</h2>{description && <p className="max-w-sm text-muted">{description}</p>}{action}</div>;
}
export function LoadingState({ label, rows = 5 }: { label: string; rows?: number }) {
  return <div role="status" aria-label={label} className="space-y-2"><span className="sr-only">{label}</span>{Array.from({ length: rows }, (_, i) => <div key={i} className="ui-skeleton h-16" />)}</div>;
}

/** Native dialog provides focus trapping, Escape and inert background content. */
export function Dialog({ open, onClose, title, children, footer, locked = false }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} className="ui-dialog"
    onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || locked) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
      <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
      <Button variant="ghost" aria-label="关闭 / Close" disabled={locked} onClick={onClose}><X className="h-4 w-4" /></Button>
    </header>
    <div className="app-scroll-region p-5">{children}</div>
    {footer && <footer className="flex justify-end gap-2 border-t border-border-subtle bg-bg-secondary px-5 py-3">{footer}</footer>}
  </dialog>;
}
