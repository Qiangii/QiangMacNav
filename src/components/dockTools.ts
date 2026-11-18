import type { DockTool } from '../types';
import { APP_ICONS } from '../visuals';

export const DOCK_TOOLS: { id: DockTool; label: string; icon: string }[] = [
  { id: 'navigation', label: '导航', icon: APP_ICONS.launchpad },
  { id: 'search', label: '搜索', icon: '/assets/icons/macos27/applications-preview.png' },
  { id: 'add', label: '添加网站', icon: APP_ICONS.appstore },
  { id: 'settings', label: '设置', icon: APP_ICONS.settings },
];
export const DEFAULT_DOCK_TOOLS: DockTool[] = ['navigation', 'search', 'settings'];
