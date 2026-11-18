import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { api, message } from '../api';
import { validPassword, PASSWORD_HINT, PASSWORD_PLACEHOLDER } from '../accountValidation';
import type { User, ManagedUser, LoginLog } from '../types';
import { MacButton, MacFormDialog, MacInput, MacSelect, notify } from './ui';
import { ConfirmDialog } from './ConfirmDialog';
import './account-settings.css';

const date = (value: string | null) => value ? new Date(value.replace(' ', 'T') + 'Z').toLocaleString() : '暂无记录';

export function ProfileSettings({ user, onUser }: { user: User; onUser: (user: User) => void }) {
  const [name, setName] = useState(user.name), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try { onUser(await api.updateAccount(name)); setEditing(false); notify('昵称已保存'); } catch (error) { notify(message(error), 'error'); } finally { setBusy(false); }
  }
  return <div className="setting-row account-name-row"><strong>当前账户</strong><div className="account-name-value">
    {editing ? <form className="account-name-editor" aria-busy={busy} onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) setEditing(false); } }}>
      <MacInput autoFocus aria-label="昵称" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={60} disabled={busy} />
      <MacButton variant="icon" aria-label="保存昵称" type="submit" disabled={busy}><Check size={16} /></MacButton>
      <MacButton variant="icon" aria-label="取消编辑昵称" disabled={busy} onClick={() => setEditing(false)}><X size={16} /></MacButton>
    </form> : <div className="account-name-display"><b>{user.name}</b><MacButton variant="icon" aria-label="编辑昵称" onClick={() => { setName(user.name); setEditing(true); }}><Pencil size={14} /></MacButton></div>}
  </div></div>;
}

export function PasswordDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [current, setCurrent] = useState(''), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalidField, setInvalidField] = useState<'password' | 'repeat' | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null), repeatInput = useRef<HTMLInputElement>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!validPassword(password)) { setInvalidField('password'); passwordInput.current?.focus(); return; }
    if (password !== repeat) { setInvalidField('repeat'); repeatInput.current?.focus(); return; }
    setInvalidField(null);
    setBusy(true);
    try { await api.changePassword(current, password); onSaved(); onClose(); }
    catch (error) { notify(message(error), 'error'); } finally { setBusy(false); }
  }
  return <MacFormDialog className="password-dialog" title="修改密码" busy={busy} onClose={onClose}>
    <form className="settings-account-form" onSubmit={save}>
      <p>当前设备保持登录，其他设备需要使用新密码登录。</p>
      <label>当前密码<MacInput autoFocus type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required placeholder="请输入当前密码" disabled={busy} /></label>
      <label>新密码<MacInput ref={passwordInput} type="password" autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setInvalidField(null); }} required placeholder={PASSWORD_PLACEHOLDER} aria-invalid={invalidField === 'password' || undefined} aria-describedby={invalidField === 'password' ? 'change-password-error' : undefined} disabled={busy} /></label>
      {invalidField === 'password' && <p id="change-password-error" className="mac-field-error" role="alert">{PASSWORD_HINT}</p>}
      <label>确认新密码<MacInput ref={repeatInput} type="password" autoComplete="new-password" value={repeat} onChange={e => { setRepeat(e.target.value); if (invalidField === 'repeat') setInvalidField(null); }} required placeholder="请再次输入新密码" aria-invalid={invalidField === 'repeat' || undefined} aria-describedby={invalidField === 'repeat' ? 'repeat-password-error' : undefined} disabled={busy} /></label>
      {invalidField === 'repeat' && <p id="repeat-password-error" className="mac-field-error" role="alert">两次输入的新密码不一致，请重新输入。</p>}
      <div className="dialog-actions"><MacButton variant="secondary" disabled={busy} onClick={onClose}>取消</MacButton><MacButton variant="primary" type="submit" disabled={busy}>{busy ? '正在修改…' : '保存密码'}</MacButton></div>
    </form>
  </MacFormDialog>;
}

export function SecuritySettings({ onChangePassword }: { onChangePassword: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return <>
    <div className="settings-user-actions"><MacButton variant="secondary" onClick={onChangePassword}>修改密码</MacButton><MacButton variant="secondary" onClick={() => setConfirm(true)}>退出其他设备</MacButton></div>
    {confirm && <ConfirmDialog title="退出其他设备？" confirmLabel="确认退出" busyLabel="正在退出…" description="当前设备保持登录，其他设备需要重新登录。" onClose={() => setConfirm(false)} onConfirm={async () => { const result = await api.revokeOtherSessions(); notify(`已退出 ${result.revoked} 个其他会话`); }} />}
    <h3 className="settings-subheading">我的登录记录</h3><LoginLogs />
  </>;
}

export function LoginLogs({ admin = false }: { admin?: boolean }) {
  const [page, setPage] = useState(1), [items, setItems] = useState<LoginLog[]>([]), [total, setTotal] = useState(0), [busy, setBusy] = useState(true), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); let alive = true; setBusy(true); setError(''); api.loginLogs(admin, page, controller.signal).then(result => { if (alive) { setItems(result.items); setTotal(result.total); } }).catch(e => { if (alive) setError(message(e)); }).finally(() => { if (alive) setBusy(false); }); return () => { alive = false; controller.abort(); }; }, [admin, page]);
  return <div className="settings-records">
    {error && <p role="alert" className="form-error">{error}</p>}
    {busy ? <p role="status">正在加载…</p> : items.length ? items.map(item => <article className="settings-record" key={item.id}>
      <div className="login-log-heading"><strong>{admin ? item.username : item.source === 'extension' ? '插件登录' : '网页登录'}</strong><span className={`login-result-badge ${item.success ? 'is-success' : 'is-failure'}`}>
        <span className="login-result-symbol" aria-hidden="true">{item.success ? <Check size={9} strokeWidth={3} /> : <X size={9} strokeWidth={3} />}</span>
        {item.success ? '登录成功' : '登录失败'}
      </span></div>
      <small>{admin && (item.source === 'extension' ? '插件登录 · ' : '网页登录 · ')}{date(item.createdAt)} · {item.ip}</small><small>{item.userAgent || '未知客户端'}</small>
    </article>) : <p>暂无登录记录</p>}
    <Pagination page={page} total={total} busy={busy} onPage={setPage} />
  </div>;
}

function Pagination({ page, total, busy, onPage }: { page: number; total: number; busy: boolean; onPage: (page: number) => void }) {
  return <div className="settings-pagination"><MacButton variant="secondary" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>上一页</MacButton><span>{page} / {Math.max(1, Math.ceil(total / 20))} · {total} 条</span><MacButton variant="secondary" disabled={busy || page * 20 >= total} onClick={() => onPage(page + 1)}>下一页</MacButton></div>;
}

export function UserManagement({ currentUser, search }: { currentUser: User; search: string }) {
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [items, setItems] = useState<ManagedUser[]>([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [editing, setEditing] = useState<ManagedUser | null>(null), [name, setName] = useState(''), [role, setRole] = useState('user'), [password, setPassword] = useState(''), [busy, setBusy] = useState(false);
  const [passwordInvalid, setPasswordInvalid] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; successMessage: string; action: () => Promise<unknown> } | null>(null);
  const pendingFeedback = useRef('');
  const refresh = (success: string) => { pendingFeedback.current = success; setRevision(x => x + 1); };
  useEffect(() => {
    const controller = new AbortController();
    let alive = true; setLoading(true); setError('');
    api.users(page, search, controller.signal).then(result => {
      if (!alive) return;
      if (!result.items.length && page > 1) { setPage(Math.max(1, Math.min(page - 1, Math.ceil(result.total / 20)))); return; }
      setItems(result.items); setTotal(result.total);
      if (pendingFeedback.current) { notify(pendingFeedback.current); pendingFeedback.current = ''; }
    }).catch(reason => {
      if (!alive) return;
      const text = pendingFeedback.current ? `${pendingFeedback.current}，但用户列表刷新失败，请刷新页面` : message(reason);
      if (pendingFeedback.current) { notify(text, 'error'); pendingFeedback.current = ''; }
      else setError(text);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [page, search, revision]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || busy) return;
    if (password && !validPassword(password)) { setPasswordInvalid(true); passwordInput.current?.focus(); return; }
    setPasswordInvalid(false);
    setBusy(true);
    try { await api.manageUser(editing.id, { name, ...(role !== editing.role ? { role } : {}), ...(password ? { password } : {}) }); setEditing(null); setPassword(''); refresh(password ? '用户资料已保存，密码已重置' : '用户资料已保存'); }
    catch (reason) { notify(message(reason), 'error'); } finally { setBusy(false); }
  }
  return <>
    {error && <p role="alert" className="form-error">{error}</p>}
    {loading ? <p role="status">正在加载用户…</p> : items.map(item => <article className="settings-record settings-user-record" key={item.id}>
      <div className="settings-user-heading"><strong>{item.name}</strong><span className={`user-badge badge-${item.role}`}>{item.role === 'admin' ? '管理员' : '普通用户'}</span><span className={`user-badge ${item.disabled ? 'badge-disabled' : 'badge-enabled'}`}>{item.disabled ? '已禁用' : '正常'}</span></div>
      {item.id !== currentUser.id && <div className="settings-user-actions">
        <MacButton variant="secondary" onClick={() => { setEditing(item); setName(item.name); setRole(item.role); setPassword(''); setPasswordInvalid(false); }}>编辑</MacButton>
        <MacButton variant="secondary" onClick={() => setConfirm({ title: `${item.disabled ? '启用' : '禁用'} ${item.username}？`, description: item.disabled ? '该用户将可以重新登录。' : '现有登录会话将失效，用户数据会保留。', successMessage: item.disabled ? '用户已启用' : '用户已禁用', action: () => api.manageUser(item.id, { disabled: !item.disabled }) })}>{item.disabled ? '启用' : '禁用'}</MacButton>
        <MacButton variant="danger" onClick={() => setConfirm({ title: `删除 ${item.username}？`, description: '将永久删除此用户、个人分类、站点及其共享站点，无法撤销。', successMessage: '用户已删除', action: () => api.deleteUser(item.id) })}>删除</MacButton>
      </div>}
      <small className="settings-user-details">{item.username}{item.id === currentUser.id ? '（当前账户）' : ''}</small><small className="settings-user-details">注册：{date(item.createdAt)} · 最近登录：{date(item.lastLogin)}</small>
    </article>)}
    {!loading && !items.length && <p>没有匹配的用户</p>}
    <Pagination page={page} total={total} busy={loading} onPage={setPage} />
    {editing && <MacFormDialog title="编辑用户" busy={busy} onClose={() => { setEditing(null); setPassword(''); }}><form className="editor-form" onSubmit={save}>
      <label>昵称<MacInput autoFocus value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={60} disabled={busy} /></label>
      <fieldset disabled={busy} className="settings-role-field"><MacSelect label="账户角色" value={role} onChange={setRole} options={[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '管理员' }]} /></fieldset>
      <label>新密码（留空则不修改）<MacInput ref={passwordInput} type="password" autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setPasswordInvalid(false); }} placeholder={PASSWORD_PLACEHOLDER} aria-invalid={passwordInvalid || undefined} aria-describedby={passwordInvalid ? 'reset-password-error' : undefined} disabled={busy} /></label>
      {passwordInvalid && <p id="reset-password-error" className="mac-field-error" role="alert">{PASSWORD_HINT}</p>}
      <p>重置密码或更改角色后，该用户需要重新登录。</p>
      <div className="dialog-actions"><MacButton variant="secondary" disabled={busy} onClick={() => { setEditing(null); setPassword(''); }}>取消</MacButton><MacButton variant="primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存修改'}</MacButton></div>
    </form></MacFormDialog>}
    {confirm && <ConfirmDialog title={confirm.title} confirmLabel="确认操作" busyLabel="正在处理…" description={confirm.description} onClose={() => setConfirm(null)} onConfirm={async () => { await confirm.action(); refresh(confirm.successMessage); }} />}
  </>;
}
