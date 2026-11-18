import { MacAlertDialog } from './ui';

export type ConfirmDialogProps = {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  confirmLabel?: string;
  busyLabel?: string;
  successMessage?: string;
};

export function ConfirmDialog({ title, description, onConfirm, onClose, confirmLabel, busyLabel, successMessage }: ConfirmDialogProps) {
  return <MacAlertDialog title={title} description={description} onConfirm={onConfirm} onClose={onClose} confirmLabel={confirmLabel} busyLabel={busyLabel} successMessage={successMessage} />;
}
