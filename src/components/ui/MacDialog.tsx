import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { usePresenceActive } from './MacPresence';

type ModalEntry = { node: HTMLElement; focus: () => void; layer: number };
const modals: ModalEntry[] = [];
const topModal = () => modals[modals.length - 1];
export const hasOpenMacDialog = () => modals.length > 0;
const focusable = (node: HTMLElement) => Array.from(node.querySelectorAll<HTMLElement>(
  'button, input, textarea, select, a[href], [tabindex], [contenteditable="true"]',
)).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');

export type MacDialogProps = ComponentPropsWithoutRef<'section'> & {
  onClose: () => void;
  onEscape?: () => void;
  backdropClassName?: string;
  initialFocus?: 'first-control' | 'container';
  closeOnBackdrop?: boolean;
  ownedElementIds?: readonly string[];
};

const noOwnedElements: readonly string[] = [];

export function MacDialog({ onClose, onEscape, backdropClassName = 'modal-backdrop', initialFocus = 'first-control', closeOnBackdrop = true, ownedElementIds = noOwnedElements, children, ...props }: MacDialogProps) {
  const active = usePresenceActive();
  const section = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => { close.current = onEscape ?? onClose; });
  useLayoutEffect(() => {
    if (!active) return;
    const node = section.current!;
    const dock = document.getElementById('desktop-dock');
    const ownedElements = () => ownedElementIds.map(id => document.getElementById(id)).filter((element): element is HTMLElement => !!element);
    const contains = (target: Node | null) => node.contains(target) || !!dock?.contains(target) || ownedElements().some(element => element.contains(target));
    let lastFocus: HTMLElement | null = null;
    const focus = () => {
      const target = lastFocus?.isConnected && node.contains(lastFocus) && !lastFocus.matches(':disabled')
        ? lastFocus : initialFocus === 'container' ? node : focusable(node)[0] ?? node;
      target.focus({ preventScroll: true });
    };
    const entry = { node, focus, layer: Number(getComputedStyle(node.parentElement!).zIndex) || 0 };
    modals.push(entry);
    modals.sort((a, b) => a.layer - b.layer);
    if (topModal() === entry) {
      if (node.contains(document.activeElement)) lastFocus = document.activeElement as HTMLElement;
      else focus();
    }
    const focusin = (event: FocusEvent) => {
      if (topModal() !== entry) return;
      if (contains(event.target as Node)) { if (node.contains(event.target as Node)) lastFocus = event.target as HTMLElement; }
      else focus();
    };
    // Bubble phase: controls such as MacSelect get the first chance to consume Escape.
    const keydown = (event: KeyboardEvent) => {
      if (topModal() !== entry || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      }
      if (event.key === 'Tab') {
        const targets = [...focusable(node), ...ownedElements().flatMap(focusable), ...(dock ? focusable(dock) : [])];
        const index = targets.indexOf(document.activeElement as HTMLElement);
        // Dock is an owned toolbar outside the section's DOM order. Walk the
        // combined scope explicitly instead of allowing Tab to reach the body.
        event.preventDefault();
        const next = index < 0 ? (event.shiftKey ? targets.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length;
        (targets[next] ?? node).focus();
      }
    };
    document.addEventListener('focusin', focusin);
    document.addEventListener('keydown', keydown);
    return () => {
      const wasTop = topModal() === entry;
      modals.splice(modals.indexOf(entry), 1);
      document.removeEventListener('focusin', focusin);
      document.removeEventListener('keydown', keydown);
      if (!wasTop) return;
      // Wait for DOM removal and other dialogs in this commit (also safe in StrictMode).
      queueMicrotask(() => {
        const next = topModal();
        if (opener?.isConnected && !opener.matches(':disabled') && !opener.closest('[inert], [hidden]') && opener.getClientRects().length && (!next || next.node.contains(opener))) opener.focus({ preventScroll: true });
        else if (next) next.focus();
        else if (dock) focusable(dock)[0]?.focus({ preventScroll: true });
      });
    };
  }, [opener, active, initialFocus, ownedElementIds]);
  return <div className={backdropClassName} onPointerDown={event => {
    if (event.target === event.currentTarget && topModal()?.node === section.current) {
      // Do not let the pointer's default focus overwrite restoration after unmount.
      event.preventDefault();
      if (closeOnBackdrop) onClose();
    }
  }}>
    <section role="dialog" aria-modal="true" aria-owns={['desktop-dock', ...ownedElementIds].join(' ')} tabIndex={-1} {...props} ref={section}>{children}</section>
  </div>;
}
