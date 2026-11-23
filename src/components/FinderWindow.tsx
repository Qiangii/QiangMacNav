import { useEffect, type ReactNode } from 'react';
import { MacWindow, useMacWindow } from './ui';
import { hasOpenMacDialog } from './ui/MacDialog';
import { usePresenceActive } from './ui/MacPresence';

function fitDesktopWindow() {
  const width = Math.max(0, Math.min(window.innerWidth - 24, Math.max(640, Math.round(window.innerWidth * .84))));
  const availableHeight = Math.max(0, window.innerHeight - 100);
  const height = Math.min(availableHeight, Math.max(window.innerHeight <= 500 ? 180 : 410, Math.round(availableHeight * .9)));
  return { size: { width, height }, position: { x: (window.innerWidth - width) / 2, y: Math.max(10, (availableHeight - height) / 2 + 10) } };
}

export function FinderWindow({ children, onClose, onMinimize, focused, onFocusWindow, zIndex, hidden }: {
  zIndex: number;
  hidden: boolean;
  focused: boolean;
  onFocusWindow: () => void;
  children: ReactNode;
  onClose: () => void;
  onMinimize: () => void;
}) {
  const active = usePresenceActive();
  const controller = useMacWindow({ cacheKey: 'finder', fit: fitDesktopWindow, hidden, minSize: { width: 640, height: window.innerHeight <= 500 ? 180 : 410 }, onClose, onMinimize });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (active && focused && event.key === 'Escape' && !event.defaultPrevented && !hasOpenMacDialog()) {
        event.preventDefault();
        if (controller.maximized) controller.toggleMaximize();
        else onClose();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, focused, onClose, controller.maximized, controller.toggleMaximize]);
  return <MacWindow controller={controller} data-desktop-window="finder" className="finder-window" aria-label="网站导航" style={{ zIndex }} onPointerDownCapture={onFocusWindow} onFocusCapture={onFocusWindow}
    titlebarClassName="finder-titlebar"
    labels={{ close: '关闭导航窗口', minimize: '最小化导航窗口', maximize: '最大化导航窗口', restore: '还原导航窗口' }}
    titlebarContent={<><span className="finder-window-title">网站导航</span><span aria-hidden="true" className="finder-titlebar-spacer" /></>}>
    {children}
  </MacWindow>;
}
