import { useContext, type ReactNode } from 'react';
import { DesktopThemeContext, TitlebarPositionContext } from './WindowPreferences';
import { createPortal } from 'react-dom';
import { MacDialog } from './MacDialog';
import { MacButton } from './MacButton';
import { usePresenceActive } from './MacPresence';
import { MacWindowResizeHandles, type MacWindowProps } from './MacWindow';
import './feedback.css';

export function MacFormDialog({ title, label = title, busy = false, className = '', children, onClose, windowController }: {
  title: string; label?: string; busy?: boolean; className?: string; children: ReactNode; onClose: () => void;
  windowController?: MacWindowProps['controller'];
}) {
  const preference = useContext(DesktopThemeContext);
  const theme = preference ?? (document.querySelector('.desktop.theme-light') ? 'light' : 'dark');
  const active = usePresenceActive();
  const position = useContext(TitlebarPositionContext);
  const close = () => { if (!busy) (windowController?.close ?? onClose)(); };
  return createPortal(<div className={`theme-${theme} mac-presence`} data-state={active ? 'open' : 'closing'} inert={!active}><MacDialog closeOnBackdrop={false} aria-label={label} aria-busy={busy}
    className={`editor-dialog mac-form-dialog ${windowController ? 'mac-form-floating' : 'mac-scroll-area'} ${className}`} style={windowController?.style} onClose={close}>
    <header className="mac-form-titlebar" data-titlebar-position={position} onPointerDown={windowController?.startMove}><MacButton className="mac-form-close" aria-label={`关闭${title}`} disabled={busy} onClick={close}><span /></MacButton><h2>{title}</h2></header>
    <div className={`mac-form-content${windowController ? ' mac-scroll-area' : ''}`}>{children}</div>
    {windowController && <MacWindowResizeHandles controller={windowController} />}
  </MacDialog></div>, document.body);
}
