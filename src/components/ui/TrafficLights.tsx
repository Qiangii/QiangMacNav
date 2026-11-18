import { MacButton } from './MacButton';
import { MacTooltip } from './MacTooltip';
import { useContext } from 'react';
import { TitlebarPositionContext } from './WindowPreferences';

export type TrafficLightsProps = {
  maximized: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  labels: { close: string; minimize: string; maximize: string; restore: string };
};

export function TrafficLights({ maximized, onClose, onMinimize, onToggleMaximize, labels }: TrafficLightsProps) {
  const position = useContext(TitlebarPositionContext);
  const controls = [
    { color: 'red', label: labels.close, action: onClose },
    { color: 'yellow', label: labels.minimize, action: onMinimize },
    { color: 'green', label: maximized ? labels.restore : labels.maximize, action: onToggleMaximize },
  ];
  const orderedControls = position === 'right' ? [controls[1], controls[2], controls[0]] : controls;
  return <div className="traffic-lights">{orderedControls.map(control => <MacTooltip key={control.color} content={control.label}><MacButton className={`traffic ${control.color}`} aria-label={control.label} onClick={control.action} /></MacTooltip>)}</div>;
}
