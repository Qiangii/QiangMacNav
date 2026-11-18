import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './primitives.css';
import { usePresenceActive } from './MacPresence';

export type MacTooltipProps = {
  content: ReactNode;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  delay?: number;
  disabled?: boolean;
};

/** Single forwarding child, no wrapper or ref replacement (safe for sortable nodes). */
export function MacTooltip({ content, children, delay = 450, disabled = false }: MacTooltipProps) {
  const active = usePresenceActive();
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, light: false });
  const close = () => { clearTimeout(timer.current); setOpen(false); };
  const show = (node: HTMLElement, immediate = false) => {
    document.dispatchEvent(new Event('mac-tooltip-dismiss'));
    clearTimeout(timer.current);
    anchor.current = node;
    if (!disabled && content) timer.current = setTimeout(() => {
      if (node.isConnected && !document.querySelector('[role="menu"], [role="listbox"], [aria-grabbed="true"], [aria-roledescription="sortable"][aria-pressed="true"]')) setOpen(true);
    }, immediate ? 0 : delay);
  };
  useEffect(() => {
    const dismiss = () => { clearTimeout(timer.current); setOpen(false); };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('contextmenu', dismiss, true);
    document.addEventListener('mac-tooltip-dismiss', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('contextmenu', dismiss, true);
      document.removeEventListener('mac-tooltip-dismiss', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const box = tip.current.getBoundingClientRect();
    const top = rect.bottom + 10 + box.height <= window.innerHeight - 8
      ? rect.bottom + 10 : rect.top - box.height - 10;
    setPosition({ left: Math.max(8, Math.min(rect.left + (rect.width - box.width) / 2, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - box.height - 8)), light: !!anchor.current.closest('.theme-light, .is-light') });
  }, [open, content]);
  const props = children.props;
  const visible = open && !disabled && active;
  return <>{cloneElement(children, {
    title: undefined,
    'aria-describedby': [props['aria-describedby'], visible ? id : null].filter(Boolean).join(' ') || undefined,
    onPointerEnter: event => { props.onPointerEnter?.(event); if (!event.buttons && event.pointerType !== 'touch') show(event.currentTarget); },
    onPointerLeave: event => { props.onPointerLeave?.(event); close(); },
    onFocus: event => { props.onFocus?.(event); if (event.currentTarget.matches(':focus-visible')) show(event.currentTarget, true); },
    onBlur: event => { props.onBlur?.(event); close(); },
    onKeyDown: event => { props.onKeyDown?.(event); if (event.key !== 'Escape') close(); },
  })}{visible && createPortal(<div ref={tip} id={id} role="tooltip" className={`mac-tooltip ${position.light ? 'is-light' : ''}`} style={{ left: position.left, top: position.top }}>{content}</div>, document.body)}</>;
}
