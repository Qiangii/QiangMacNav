import { useEffect, useState } from 'react';
import { Camera, LogOut } from 'lucide-react';
import { api, message } from '../api';
import type { Preferences, User, SiteBranding } from '../types';
import { MacButton, MacInput, MacScrollArea, MacSettingChoice, MacSwitch, MacWindow, useMacWindow, useNotify, dismissNotifications } from './ui';
import { hasOpenMacDialog } from './ui/MacDialog';
import { ProfileSettings, PasswordDialog, SecuritySettings, UserManagement, LoginLogs } from './AccountSettings';
import { MacPresence } from './ui/MacPresence';
import { isCachedText, useDesktopState } from '../desktopCache';
import { ImagePickerDialog } from './ImagePickerDialog';
import { MediaPreview } from './MediaPreview';
import { WallpaperSettings } from './WallpaperSettings';
import { IconBackgroundSettings } from './IconBackgroundSettings';
import { DesktopSearchSettings } from './DesktopSearchSettings';
import { DockToolSettings } from './DockToolSettings';
import { DEFAULT_DOCK_TOOLS } from './dockTools';
import { SiteBrandingSettings } from './SiteBrandingSettings';
import { SystemUpdates } from './SystemUpdates';
import { SystemIcon } from './SystemIcon';

type Section = 'account' | 'security' | 'users' | 'logs' | 'applications' | 'appearance' | 'admin' | 'updates';

function fitSettingsWindow() {
  const width = Math.max(0, Math.min(920, window.innerWidth - 24));
  const height = Math.max(0, Math.min(680, window.innerHeight - 100));
  return { size: { width, height }, position: { x: Math.max(12, (window.innerWidth - width) / 2), y: Math.max(10, (window.innerHeight - height - 85) / 2) } };
}

export function SettingsWindow({ user, onUser, preferences, preferencesSaving, hidden, onPreferences, onClose, onMinimize, onLogout, onRegistration, branding, onBranding, focused, onFocusWindow, zIndex }: {
  branding: SiteBranding;
  onBranding: (value: SiteBranding) => void;
  zIndex: number;
  focused: boolean;
  onFocusWindow: () => void;
  user: User;
  onUser: (user: User) => void;
  preferences: Preferences;
  preferencesSaving: boolean;
  hidden: boolean;
  onPreferences: (value: Preferences, successMessage?: string, errorContext?: string) => Promise<void>;
  onClose: () => void;
  onMinimize: () => void;
  onLogout: () => Promise<void>;
  onRegistration: () => Promise<void>;
}) {
  const [section, setSection] = useDesktopState<Section>('settings:section', 'account', (value): value is Section =>
    typeof value === 'string' && (['account', 'security', 'applications', 'appearance'].includes(value) || user.role === 'admin' && ['users', 'logs', 'admin', 'updates'].includes(value)));
  const [registration, setRegistration] = useState<boolean | null>(null);
  const notify = useNotify();
  const [error, setError] = useState('');
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || preferencesSaving;
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [userQuery, setUserQuery] = useDesktopState('settings:userQuery', '', isCachedText), [userSearch, setUserSearch] = useDesktopState('settings:userSearch', '', isCachedText);
  const canLeave = () => !busy && !document.querySelector('[aria-busy="true"]');
  const close = () => { if (canLeave()) onClose(); };
  const controller = useMacWindow({ cacheKey: 'settings', fit: fitSettingsWindow, hidden, onClose: close, onMinimize: () => { if (canLeave()) onMinimize(); } });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (focused && !hidden && event.key === 'Escape' && !event.defaultPrevented && !hasOpenMacDialog()) {
        event.preventDefault();
        if (controller.maximized) controller.toggleMaximize(); else close();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [focused, hidden, controller.maximized, controller.toggleMaximize, close]);

  useEffect(() => {
    if (section !== 'admin' || user.role !== 'admin' || hidden || !focused) return;
    const controller = new AbortController();
    setError('');
    api.adminSettings(controller.signal).then(result => { if (!controller.signal.aborted) setRegistration(result.registrationEnabled); }).catch(reason => { if (!controller.signal.aborted) setError(message(reason)); });
    return () => controller.abort();
  }, [section, user.role, hidden, focused]);

  async function changePreferences(value: Preferences, successMessage?: string) {
    if (busy) return false;
    setBusy(true);
    try { setError(''); await onPreferences(value, successMessage); return true; } catch { return false; }
    finally { setBusy(false); }
  }

  async function changeRegistration(value: boolean) {
    setBusy(true); setError('');
    try {
      const saved = await api.setRegistration(value);
      setRegistration(saved.registrationEnabled);
      try { await onRegistration(); notify(value ? '用户注册已开放' : '用户注册已关闭'); }
      catch { notify('注册设置已保存，但状态刷新失败，请刷新页面', 'error'); }
    } catch (reason) { notify(message(reason), 'error'); }
    finally { setBusy(false); }
  }

  const sections: { id: Section; label: string; icon: string }[] = [
    { id: 'account', label: '账户', icon: 'settings-sidebar-apple-account' },
    { id: 'security', label: '账户安全', icon: 'settings-sidebar-privacy-and-security' },
    ...(user.role === 'admin' ? [{ id: 'users' as Section, label: '用户管理', icon: 'settings-sidebar-users-and-groups' }] : []),
    ...(user.role === 'admin' ? [{ id: 'logs' as Section, label: '登录日志', icon: 'settings-sidebar-time-machine' }] : []),
    { id: 'applications', label: '应用设置', icon: 'settings-sidebar-desktop-and-dock' },
    { id: 'appearance', label: '外观壁纸', icon: 'settings-sidebar-wallpaper' },
    ...(user.role === 'admin' ? [{ id: 'admin' as Section, label: '系统管理', icon: 'settings-sidebar-general' }] : []),
    ...(user.role === 'admin' ? [{ id: 'updates' as Section, label: '系统更新', icon: 'applications-appstore' }] : []),
  ];

  return <>
    <MacWindow controller={controller} data-desktop-window="settings" aria-label="系统设置" className="settings-window" titlebarClassName="window-titlebar" style={{ position: 'fixed', zIndex }} onPointerDownCapture={onFocusWindow} onFocusCapture={onFocusWindow}
      labels={{ close: '关闭设置', minimize: '最小化设置', maximize: '放大窗口', restore: '还原窗口' }}
      titlebarContent={<><span>系统设置</span><span className="window-titlebar-spacer" aria-hidden="true" /></>}>
      <div className="settings-body">
        <div className="settings-sidebar-column"><MacScrollArea role="complementary" className="settings-sidebar"><div className="settings-user"><MacButton className="settings-avatar settings-avatar-button" aria-label="修改头像" disabled={busy} onClick={() => setAvatarOpen(true)}><MediaPreview url={user.avatarUrl} fallback={user.name.slice(0, 1).toUpperCase()} /><span className="settings-avatar-edit"><Camera size={17} /></span></MacButton><span><strong>{user.name}</strong><small>{user.role === 'admin' ? '管理员' : '个人账户'}</small></span></div>
          <div className="sidebar-caption">设置</div>
           <nav aria-label="设置分类">{sections.map(item => <MacButton key={item.id} aria-label={item.label} className={section === item.id ? 'selected' : ''} onClick={() => { if (item.id !== section && canLeave()) { dismissNotifications(); setSection(item.id); setError(''); } }}><span className="settings-section-icon" aria-hidden="true"><SystemIcon src={`/assets/icons/macos27/${item.icon}.png`} /></span><span className="settings-section-label">{item.label}</span></MacButton>)}</nav>
        </MacScrollArea>
        </div>
        <MacScrollArea className="settings-content" cacheKey={`settings:${section}`}>
          <div className="settings-page-heading"><h2>{sections.find(item => item.id === section)?.label}</h2>
            {section === 'users' && user.role === 'admin' && <form className="settings-user-search settings-record-toolbar" onSubmit={event => { event.preventDefault(); setUserSearch(userQuery.trim()); }}><MacInput aria-label="搜索用户" placeholder="账号或昵称" value={userQuery} onChange={event => setUserQuery(event.target.value)} /><MacButton variant="secondary" type="submit">搜索</MacButton></form>}
          </div>
          {section === 'security' && <SecuritySettings onChangePassword={() => setPasswordOpen(true)} />}
          {section === 'users' && user.role === 'admin' && <UserManagement key={userSearch} currentUser={user} search={userSearch} />}
          {section === 'logs' && user.role === 'admin' && <LoginLogs admin />}
          {section === 'updates' && user.role === 'admin' && <SystemUpdates active={focused && !hidden} />}
          {section === 'admin' && focused && !hidden && error && <div className="settings-error" role="alert">{error}</div>}
          {section === 'account' && <><div className="settings-list">
            <ProfileSettings user={user} onUser={onUser} />
            <div className="setting-row"><div><strong>账号</strong><span>用于登录此桌面，不区分大小写</span></div><b className="settings-email">{user.username}</b></div>
            <div className="setting-row"><div><strong>账户类型</strong></div><b>{user.role === 'admin' ? '管理员' : '成员'}</b></div>
            <MacButton className="setting-row setting-action" onClick={onLogout}><div><strong>退出登录</strong><span>下次访问需要重新登录</span></div><LogOut size={18} /></MacButton>
          </div></>}
          {section === 'applications' && <>
            <h3 className="settings-subheading">网站导航</h3>
            <div className="settings-list"><MacSettingChoice<Preferences['navigationDragMode']> label="网站导航排序方式" description="可长按分类标题或网站，也可使用拖拽标识排序" value={preferences.navigationDragMode ?? 'handle'} options={[{ value: 'longPress', label: '长按' }, { value: 'handle', label: '标识' }]} disabled={busy} onChange={navigationDragMode => changePreferences({ ...preferences, navigationDragMode })} /><IconBackgroundSettings preferences={preferences} busy={busy} onChange={changePreferences} /></div>
            <DesktopSearchSettings preferences={preferences} busy={busy} hidden={hidden} onChange={changePreferences} />
          </>}
          {section === 'appearance' && <>
            <div className="settings-list">
              <MacSettingChoice<Preferences['theme']> label="外观" description="选择桌面和窗口的颜色" value={preferences.theme} options={[{ value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }]} disabled={busy} onChange={theme => changePreferences({ ...preferences, theme })} />
              <MacSettingChoice<Preferences['titlebarPosition']> label="标题栏按钮位置" description="选择窗口控制按钮的位置" value={preferences.titlebarPosition ?? 'left'} options={[{ value: 'left', label: '靠左' }, { value: 'right', label: '靠右' }]} disabled={busy} onChange={titlebarPosition => changePreferences({ ...preferences, titlebarPosition })} />
              <MacSettingChoice<Preferences['launchpadScrollMode']> label="启动台滚动方式" description="图标较多时，上下滚动或左右翻页查看" value={preferences.launchpadScrollMode ?? 'horizontal'} options={[{ value: 'vertical', label: '上下' }, { value: 'horizontal', label: '左右' }]} disabled={busy} onChange={launchpadScrollMode => changePreferences({ ...preferences, launchpadScrollMode })} />
              <div className="setting-row"><div><strong>拖拽时显示定位网格</strong><span>显示桌面网格线和图标落位虚线框</span></div><MacSwitch aria-label="拖拽时显示定位网格" checked={preferences.desktopDragGrid ?? false} disabled={busy} onChange={event => { void changePreferences({ ...preferences, desktopDragGrid: event.target.checked }); }} /></div>
            </div>
            <DockToolSettings value={preferences.dockTools ?? DEFAULT_DOCK_TOOLS} busy={busy} onChange={dockTools => { void changePreferences({ ...preferences, dockTools }, 'Dock 图标设置已保存'); }} />
            <h3 className="settings-subheading">桌面壁纸</h3>
            <WallpaperSettings preferences={preferences} onChange={onPreferences} />
          </>}
          {section === 'admin' && user.role === 'admin' && <><SiteBrandingSettings value={branding} onSaved={onBranding} disabled={busy} /><h3 className="settings-subheading">访问设置</h3><div className="settings-list">
            <div className="setting-row"><div><strong>开放用户注册</strong><span>关闭后注册入口与注册接口同时停用</span></div><MacSwitch checked={registration ?? false} disabled={registration === null || busy} onChange={event => changeRegistration(event.target.checked)} aria-label="开放用户注册" /></div>
          </div></>}
        </MacScrollArea>
      </div>
    </MacWindow>
    <MacPresence open={passwordOpen && !hidden}><PasswordDialog onClose={() => setPasswordOpen(false)} onSaved={() => notify('密码已修改，当前设备保持登录')} /></MacPresence>
    <MacPresence open={avatarOpen && !hidden}><ImagePickerDialog title="管理头像" kind="avatar" value={user.avatarUrl} onClose={() => setAvatarOpen(false)} onSelect={async url => { onUser(await api.updateAvatar(url)); notify('头像已更新'); }} /></MacPresence>
  </>;
}
