import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';

export type MenuEntry = { label: string; icon?: ReactNode; action?: () => void; disabled?: boolean; checked?: boolean; children?: MenuItem[] };
export type MenuItem = MenuEntry | { separator: true };
export type MenuState = { x: number; y: number; items: MenuItem[] };
export const NAVIGATION_MENU_IDS = ['navigation-context-menu', 'navigation-context-submenu'] as const;

function actionable(item: MenuItem): item is MenuEntry { return !('separator' in item); }

export function ContextMenu({ menu, onClose, restoreFocus = false }: { menu: MenuState; onClose: () => void; restoreFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const childRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });
  const [active, setActive] = useState(-1);
  const [submenu, setSubmenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const [childActive, setChildActive] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - el.offsetWidth - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8));
    setPosition({ x, y });
    el.focus();
    const dismiss = (event: PointerEvent) => { if (!el.contains(event.target as Node) && !childRef.current?.contains(event.target as Node)) onClose(); };
    const scroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && (el.contains(target) || childRef.current?.contains(target))) return;
      onClose();
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', scroll);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', scroll); window.removeEventListener('scroll', scroll, true);
      const hadFocus = el.contains(document.activeElement) || !!childRef.current?.contains(document.activeElement);
      if (restoreFocus && hadFocus) queueMicrotask(() => {
        if (document.activeElement === document.body && opener?.isConnected && !opener.matches(':disabled') && !opener.closest('[inert], [hidden]')) opener.focus({ preventScroll: true });
      });
    };
  }, [menu.x, menu.y, onClose, restoreFocus]);

  useLayoutEffect(() => {
    if (!submenu || !ref.current || !childRef.current) return;
    const parent = ref.current;
    const child = childRef.current;
    const row = parent.querySelector<HTMLElement>(`[data-menu-index="${submenu.index}"]`);
    if (!row) return;
    const place = () => {
      const parentRect = parent.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();
      const rightSpace = window.innerWidth - 8 - parentRect.right;
      const leftSpace = parentRect.left - 8;
      const openRight = childRect.width <= rightSpace || childRect.width > leftSpace && rightSpace >= leftSpace;
      const x = Math.max(8, Math.min(openRight ? parentRect.right : parentRect.left - childRect.width, window.innerWidth - childRect.width - 8));
      const style = getComputedStyle(child);
      const inset = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
      const y = Math.max(8, Math.min(row.getBoundingClientRect().top - inset, window.innerHeight - childRect.height - 8));
      setSubmenu(previous => previous?.index === submenu.index && (previous.x !== x || previous.y !== y) ? { ...previous, x, y } : previous);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(parent); observer.observe(child);
    parent.addEventListener('scroll', place);
    return () => { observer.disconnect(); parent.removeEventListener('scroll', place); };
  }, [submenu?.index, position.x, position.y, menu.items]);

  function openChild(index: number, element: HTMLElement) {
    const item = menu.items[index];
    if (!actionable(item) || !item.children || item.disabled) { setSubmenu(null); return; }
    const rect = element.getBoundingClientRect();
    setSubmenu(previous => previous?.index === index ? previous : { index, x: rect.right, y: rect.top });
  }

  function execute(item: MenuEntry) {
    if (item.disabled || item.children) return;
    item.action?.();
    onClose();
  }

  function onChildKeyDown(event: KeyboardEvent) {
    const parent = submenu && menu.items[submenu.index];
    if (!parent || !actionable(parent) || !parent.children) return;
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); setSubmenu(null); ref.current?.focus(); return; }
    const selectable = parent.children.filter(item => actionable(item) && !item.disabled) as MenuEntry[];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setChildActive(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + selectable.length) % selectable.length);
    }
    if ((event.key === 'Enter' || event.key === ' ') && selectable[childActive]) { event.preventDefault(); execute(selectable[childActive]); }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    const enabled = menu.items.map((item, i) => actionable(item) && !item.disabled ? i : -1).filter(i => i !== -1);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = enabled.indexOf(active);
      const next = event.key === 'ArrowDown' ? (index + 1) % enabled.length : (index - 1 + enabled.length) % enabled.length;
      setActive(enabled[next] ?? -1);
      setSubmenu(null);
    }
    if (active < 0) return;
    const item = menu.items[active];
    if (!actionable(item)) return;
    if (event.key === 'ArrowRight' && item.children) {
      event.preventDefault();
      const element = ref.current?.querySelector(`[data-menu-index="${active}"]`) as HTMLElement | null;
      if (element) { openChild(active, element); setChildActive(0); requestAnimationFrame(() => childRef.current?.focus()); }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault(); setSubmenu(null);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (item.children) {
        const element = ref.current?.querySelector(`[data-menu-index="${active}"]`) as HTMLElement | null;
        if (element) { openChild(active, element); setChildActive(0); requestAnimationFrame(() => childRef.current?.focus()); }
      } else execute(item);
    }
  }

  return <>
    <div id={NAVIGATION_MENU_IDS[0]} className="context-menu mac-scroll-area" ref={ref} style={{ left: position.x, top: position.y }} role="menu" aria-label="操作菜单" tabIndex={-1} onKeyDown={onKeyDown}>
      {menu.items.map((item, i) => !actionable(item) ? <div key={`divider-${i}`} className="menu-divider" role="separator" /> :
        <button key={`${item.label}-${i}`} data-menu-index={i} type="button" role="menuitem" aria-disabled={item.disabled || undefined} className={`menu-item ${active === i ? 'active' : ''}`} disabled={item.disabled} onMouseEnter={event => { setActive(i); openChild(i, event.currentTarget); }} onClick={event => item.children ? openChild(i, event.currentTarget) : execute(item)}>
          <span className="menu-item-icon">{item.checked ? <Check size={14} /> : item.icon}</span><span>{item.label}</span>{item.children && <ChevronRight size={14} className="menu-chevron" />}
        </button>)}
    </div>
    {submenu && (() => {
      const item = menu.items[submenu.index];
      if (!actionable(item)) return null;
      return <div id={NAVIGATION_MENU_IDS[1]} className="context-menu context-submenu mac-scroll-area" ref={childRef} role="menu" aria-label={item.label} tabIndex={-1} onKeyDown={onChildKeyDown} style={{ left: submenu.x, top: submenu.y }}>
        {item.children?.map((child, index) => !actionable(child) ? <div key={index} className="menu-divider" role="separator" /> : <button key={`${child.label}-${index}`} role="menuitem" disabled={child.disabled} aria-disabled={child.disabled || undefined} className={`menu-item ${childActive === item.children!.filter((entry, i) => i < index && actionable(entry) && !entry.disabled).length && !child.disabled ? 'active' : ''}`} onMouseEnter={() => setChildActive(item.children!.filter((entry, i) => i < index && actionable(entry) && !entry.disabled).length)} onClick={() => execute(child)}><span className="menu-item-icon">{child.checked ? <Check size={14} /> : child.icon}</span><span>{child.label}</span></button>)}
      </div>;
    })()}
  </>;
}
