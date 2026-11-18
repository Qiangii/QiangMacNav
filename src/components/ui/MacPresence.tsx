import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import './presence.css';

const ActiveContext = createContext(true);
export const usePresenceActive = () => useContext(ActiveContext);

/** Keep the actual subtree alive until its exit completes. Reopening cancels exit. */
export function MacPresence({ open, children, keepMounted = false }: { open: boolean; children: ReactNode; keepMounted?: boolean }) {
  const [present, setPresent] = useState(open);
  const [retained, setRetained] = useState(children);
  if (children && children !== retained) setRetained(children);
  if (open && !present) setPresent(true);
  useLayoutEffect(() => {
    if (open) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => setPresent(false);
    if (motion.matches) { finish(); return; }
    const timer = window.setTimeout(finish, 180);
    const changed = () => { if (motion.matches) finish(); };
    motion.addEventListener('change', changed);
    return () => { window.clearTimeout(timer); motion.removeEventListener('change', changed); };
  }, [open]);
  if (!present && !keepMounted) return null;
  return <ActiveContext.Provider value={open}><div className="mac-presence" data-state={open ? 'open' : present ? 'closing' : 'hidden'} inert={!open}>{children || retained}</div></ActiveContext.Provider>;
}
