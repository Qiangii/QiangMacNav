import { useContext, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DesktopThemeContext } from './WindowPreferences';
import { usePresenceActive } from './MacPresence';
import { AlertTriangle } from 'lucide-react';
import { MacDialog } from './MacDialog';
import { MacButton } from './MacButton';
import { useNotify } from './MacToast';
import './primitives.css';

export type MacAlertDialogProps = {
  title: string;
  description: ReactNode;
  icon?: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  cancelLabel?: string;
  successMessage?: string;
  notifyErrors?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export function MacAlertDialog({ title, description, icon = <AlertTriangle size={32} />, confirmLabel = '确认删除', busyLabel = '正在删除…', cancelLabel = '取消', successMessage, notifyErrors = true, onConfirm, onClose }: MacAlertDialogProps) {
  const notify = useNotify();
  const id = useId();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const theme = useContext(DesktopThemeContext) ?? 'dark';
  const active = usePresenceActive();
  const close = () => { if (!pending.current) onClose(); };
  async function confirm() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await onConfirm(); if (successMessage) notify(successMessage); onClose(); }
    catch (reason) { const text = reason instanceof Error ? reason.message : '操作失败，请重试'; if (notifyErrors) notify(text, 'error'); }
    finally { pending.current = false; setBusy(false); }
  }
  return createPortal(<div className={`theme-${theme} mac-presence`} data-state={active ? 'open' : 'closing'} inert={!active}><MacDialog onClose={close} backdropClassName="modal-backdrop mac-alert-backdrop" className="confirm-dialog mac-alert-dialog mac-scroll-area" role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy}>
    <div className="mac-alert-icon" aria-hidden="true">{icon}</div>
    <h2 id={`${id}-title`}>{title}</h2><p id={`${id}-description`}>{description}</p>
    <div role="status" className="mac-alert-status">{busy ? busyLabel : ''}</div>
    <div className="dialog-actions"><MacButton variant="secondary" aria-disabled={busy} onClick={close}>{cancelLabel}</MacButton><MacButton variant="danger" disabled={busy} onClick={confirm}>{busy ? busyLabel : confirmLabel}</MacButton></div>
  </MacDialog></div>, document.body);
}
