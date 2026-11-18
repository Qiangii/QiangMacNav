import { useId } from 'react';
import type { DockTool } from '../types';
import { DOCK_TOOLS } from './dockTools';
import { SystemIcon } from './SystemIcon';
import { MacButton } from './ui';
import './dock-tools.css';

export function DockToolSettings({ value, busy, onChange }: { value: DockTool[]; busy: boolean; onChange: (value: DockTool[]) => void }) {
  const heading = useId();
  return <section aria-labelledby={heading}>
    <h3 id={heading} className="settings-subheading">Dock 固定图标</h3>
    <fieldset className="settings-list dock-tool-settings" aria-labelledby={heading} disabled={busy} aria-busy={busy}>
      <p className="dock-tool-description">选择要在 Dock 中显示的图标</p>
      <div className="dock-tool-options">{DOCK_TOOLS.map(tool => <MacButton key={tool.id} className={`dock-tool-option${value.includes(tool.id) ? ' selected' : ''}`} aria-label={tool.label} aria-pressed={value.includes(tool.id)} onClick={() => onChange(DOCK_TOOLS.filter(item => item.id === tool.id ? !value.includes(item.id) : value.includes(item.id)).map(item => item.id))}>
        <SystemIcon src={tool.icon} /><span>{tool.id === 'add' ? '添加' : tool.label}</span>
      </MacButton>)}</div>
    </fieldset>
  </section>;
}
