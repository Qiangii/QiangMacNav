import { useId, useState, type ReactNode } from 'react';
import { PanelLeft } from 'lucide-react';
import { MacButton } from './ui';
import './window-sidebar.css';

export function WindowSidebar({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const label = expanded ? '收起侧边栏' : '展开侧边栏';
  return <div className="window-sidebar" data-expanded={expanded}>
    <div className="window-sidebar-pane" id={id}>{children}</div>
    <MacButton className="window-sidebar-toggle" aria-label={label} title={label} aria-controls={id} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><PanelLeft size={19} aria-hidden="true" /></MacButton>
  </div>;
}
