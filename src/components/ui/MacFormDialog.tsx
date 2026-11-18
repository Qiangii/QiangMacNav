import { useContext, type ReactNode } from 'react';
import { DesktopThemeContext, TitlebarPositionContext } from './WindowPreferences';
import { createPortal } from 'react-dom';
import { MacDialog } from './MacDialog';
import { MacButton } from './MacButton';
import { usePresenceActive } from './MacPresence';
import './feedback.css';

export function MacFormDialog({ title, label = title, busy = false, className = '', children, onClose }: {
  title: string; label?: string; busy?: boolean; className?: string; children: ReactNode; onClose: () => void;
}) {
  const preference = useContext(DesktopThemeContext);
  const theme = preference ?? (document.querySelector('.desktop.theme-light') ? 'light' : 'dark');
  const active = usePresenceActive();
  const position = useContext(TitlebarPositionContext);
  return createPortal(<div className={`theme-${theme} mac-presence`} data-state={active ? 'open' : 'closing'} inert={!active}><MacDialog closeOnBackdrop={false} aria-label={label} aria-busy={busy} className={`editor-dialog mac-form-dialog mac-scroll-area ${className}`} onClose={() => { if (!busy) onClose(); }}>
    <header className="mac-form-titlebar" data-titlebar-position={position}><MacButton className="mac-form-close" aria-label={`关闭${title}`} disabled={busy} onClick={onClose}><span /></MacButton><h2>{title}</h2></header>
    <div className="mac-form-content">{children}</div>
  </MacDialog></div>, document.body);
}
