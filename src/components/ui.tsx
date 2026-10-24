'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { X, ArrowUpRight, Check, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
function useRestoreFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const target = opener.current?.isConnected ? opener.current : document.getElementById('main');
      target?.focus({ preventScroll: true });
    },
  };
}
export function Button({
  className = '',
  variant = 'primary',
  busy = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button button-${variant} ${className}`}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle size={16} className="spinner" />}
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'blue' | 'amber' | 'red';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function ExternalLink({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={`external-link ${className}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ArrowUpRight size={15} />
      <span className="sr-only"> (opens a new tab)</span>
    </a>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const focus = useRestoreFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          {...focus}
          aria-modal="true"
          className={`dialog-content ${wide ? 'dialog-wide' : ''}`}
        >
          <div className="dialog-heading">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="icon-button" aria-label="Close dialog">
              <X size={21} />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className={description ? 'dialog-description' : 'sr-only'}>
            {description ?? title}
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function EvidenceDrawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const focus = useRestoreFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content {...focus} aria-modal="true" className="evidence-drawer">
          <div className="drawer-heading">
            <span className="eyebrow">TASTEKEEPER / EVIDENCE</span>
            <DialogPrimitive.Close className="icon-button" aria-label="Close evidence drawer">
              <X size={21} />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description>
            What was permitted, what happened, and what remains private.
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function ConfirmEnd({
  open,
  onOpenChange,
  name,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  onConfirm: () => void;
  busy: boolean;
}) {
  const focus = useRestoreFocus();
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="dialog-overlay" />
        <AlertDialogPrimitive.Content {...focus} aria-modal="true" className="dialog-content">
          <AlertDialogPrimitive.Title>End this connection?</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description>
            {name} will no longer be able to make requests through TASTEKEEPER. Results already
            shared cannot be recalled. Reconnecting will require a new invitation.
          </AlertDialogPrimitive.Description>
          <div className="dialog-actions">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary" disabled={busy}>
                Keep connection
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button variant="danger" busy={busy} onClick={onConfirm}>
              End access
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
export function CheckLine({ children }: { children: ReactNode }) {
  return (
    <div className="check-line">
      <Check size={16} />
      <span>{children}</span>
    </div>
  );
}
export function NavigationDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const focus = useRestoreFocus();
  useEffect(() => {
    const desktop = window.matchMedia('(min-width:768px)');
    const closeOnDesktop = () => {
      if (desktop.matches) onOpenChange(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [onOpenChange]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="mobile-navigation-overlay" />
        <DialogPrimitive.Content
          {...focus}
          aria-modal="true"
          className="sidebar mobile-sidebar is-open"
        >
          <DialogPrimitive.Title className="sr-only">Workspace navigation</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Navigate Mira’s sample workspace and connected clients.
          </DialogPrimitive.Description>
          <DialogPrimitive.Close
            className="icon-button navigation-close"
            aria-label="Close navigation"
          >
            <X size={21} />
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
