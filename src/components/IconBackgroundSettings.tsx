import { useState } from 'react';
import type { Preferences } from '../types';
import { DEFAULT_ICON_BACKGROUND } from './IconAppearance';
import { MacButton, MacSwitch } from './ui';
import { MacPresence } from './ui/MacPresence';
import { ColorPickerDialog } from './ColorPickerDialog';
import './icon-background-settings.css';

export function IconBackgroundSettings({ preferences, busy, onChange }: {
  preferences: Preferences; busy: boolean; onChange: (value: Preferences) => Promise<boolean>;
}) {
  const savedColor = preferences.iconBackgroundColor || DEFAULT_ICON_BACKGROUND;
  const [pickerOpen, setPickerOpen] = useState(false);
  const enabled = preferences.iconBackgroundEnabled ?? true;
  return <>
    <div className="setting-row"><div><strong>图标背景填充</strong><span>关闭后保留图片的透明背景</span></div><MacSwitch aria-label="图标背景填充" checked={enabled} disabled={busy} onChange={event => { void onChange({ ...preferences, iconBackgroundEnabled: event.target.checked }); }} /></div>
    {enabled && <div className="setting-row icon-background-row"><div><strong>图标背景颜色填充</strong></div>
      <div className="icon-background-controls">
        <MacButton className="icon-background-swatch" aria-label="选择图标背景颜色" aria-haspopup="dialog" disabled={busy} onClick={() => setPickerOpen(true)}><span style={{ background: savedColor }} /></MacButton>
        <MacButton variant="secondary" disabled={busy || savedColor === DEFAULT_ICON_BACKGROUND} onClick={() => { void onChange({ ...preferences, iconBackgroundColor: DEFAULT_ICON_BACKGROUND }); }}>恢复默认</MacButton>
      </div>
    </div>}
    <MacPresence open={pickerOpen}>{pickerOpen && <ColorPickerDialog value={savedColor} onClose={() => setPickerOpen(false)} onConfirm={color => onChange({ ...preferences, iconBackgroundColor: color })} />}</MacPresence>
  </>;
}
