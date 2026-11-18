import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert } from 'lucide-react';
import { DesktopThemeContext } from './WindowPreferences';
import './feedback.css';

type Toast = { message: string; kind: 'success' | 'error' };
export function notify(message: string, kind: Toast['kind'] = 'success') {
  window.dispatchEvent(new CustomEvent<Toast>('mac-notification', { detail: { message, kind } }));
}
export function MacToastHost() {
  const theme = useContext(DesktopThemeContext) ?? 'dark';
  const [toast, setToast] = useState<(Toast & { id: number }) | null>(null);
  useEffect(() => {
    let id = 0;
    const show = (event: Event) => setToast({ ...(event as CustomEvent<Toast>).detail, id: ++id });
    window.addEventListener('mac-notification', show);
    return () => window.removeEventListener('mac-notification', show);
  }, []);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), 3500); return () => clearTimeout(timer); } }, [toast]);
  return toast && createPortal(<div key={toast.id} className={`mac-feedback-toast theme-${theme} ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} aria-atomic="true">
    <span className="mac-feedback-icon" aria-hidden="true">{toast.kind === 'success' ? <Check size={15} strokeWidth={2.5} /> : <CircleAlert size={16} strokeWidth={2} />}</span>
    <span className="mac-feedback-message">{toast.message}</span>
  </div>, document.body);
}
