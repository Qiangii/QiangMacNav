import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Ban, Check, ChevronLeft, ChevronRight, CircleCheck, Globe, Pencil, Puzzle, Trash2, X } from 'lucide-react';
import { api, message } from '../api';
import { validPassword, PASSWORD_HINT, PASSWORD_PLACEHOLDER } from '../accountValidation';
import type { User, ManagedUser, LoginLog } from '../types';
import { MacButton, MacFormDialog, MacInput, MacSelect, MacTable, MacTooltip, notify, type MacTableColumn } from './ui';
import { ConfirmDialog } from './ConfirmDialog';
import './account-settings.css';

function RecordTime({ value }: { value: string | null }) {
  if (!value) return <span className="record-secondary">暂无记录</span>;
  const iso = value.replace(' ', 'T') + 'Z';
  const local = new Date(iso);
  return <time className="record-time" dateTime={iso}>{local.toLocaleDateString()}<small>{local.toLocaleTimeString()}</small></time>;
}

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
  const columns: MacTableColumn<LoginLog>[] = [];
  if (admin) columns.push({ heading: '账号', cell: item => <strong className="record-name">{item.username}</strong> });
  columns.push(
    { heading: '登录时间', width: '96px', cell: item => <RecordTime value={item.createdAt} /> },
    { heading: '来源', width: '88px', cell: item => <span className="record-source">{item.source === 'extension' ? <><Puzzle />插件登录</> : <><Globe />网页登录</>}</span> },
    { heading: 'IP / 客户端', width: '32%', cell: item => <><span className="record-ip">{item.ip}</span>{item.userAgent ? <details className="record-client"><summary>客户端信息</summary>{item.userAgent}</details> : <small className="record-secondary">未知客户端</small>}</> },
    { heading: '结果', width: '92px', cell: item => <span className={`login-result-badge ${item.success ? 'is-success' : 'is-failure'}`}><span className="login-result-symbol" aria-hidden="true">{item.success ? <Check size={9} /> : <X size={9} />}</span>{item.success ? '登录成功' : '登录失败'}</span> },
  );
  return <MacTable label={admin ? '登录日志' : '我的登录记录'} minWidth={admin ? 520 : 420} columns={columns} rows={items} rowKey={item => item.id}
    loading={busy} error={error} emptyText="暂无登录记录" footer={<Pagination page={page} total={total} busy={busy} onPage={setPage} />} />;
}

function Pagination({ page, total, busy, onPage }: { page: number; total: number; busy: boolean; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / 20));
  return <nav className="settings-pagination" aria-label="表格分页"><span>共 {total} 条</span><div>
    <MacButton variant="icon" aria-label="上一页" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /></MacButton>
    <span aria-label={`第 ${page} 页，共 ${pages} 页`}>{page} / {pages}</span>
    <MacButton variant="icon" aria-label="下一页" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={15} /></MacButton>
  </div></nav>;
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
  const columns: MacTableColumn<ManagedUser>[] = [
    { heading: '用户', cell: item => <><strong className="record-name">{item.name}</strong><small className="record-secondary">{item.username}</small></> },
    { heading: '角色 / 状态', width: '82px', cell: item => <>{item.role === 'admin' ? '管理员' : '普通用户'}<small className={`record-status ${item.disabled ? 'is-disabled' : ''}`}>{item.disabled ? '已禁用' : '正常'}</small></> },
    { heading: '注册时间', width: '96px', cell: item => <RecordTime value={item.createdAt} /> },
    { heading: '最近登录', width: '96px', cell: item => <RecordTime value={item.lastLogin} /> },
    { heading: '操作', width: '110px', cell: item => item.id === currentUser.id ? <small className="record-secondary">当前账户</small> : <div className="record-actions">
      <MacTooltip content="编辑"><MacButton variant="icon" aria-label={`编辑 ${item.username}`} onClick={() => { setEditing(item); setName(item.name); setRole(item.role); setPassword(''); setPasswordInvalid(false); }}><Pencil /></MacButton></MacTooltip>
      <MacTooltip content={item.disabled ? '启用' : '禁用'}><MacButton variant="icon" aria-label={`${item.disabled ? '启用' : '禁用'} ${item.username}`} onClick={() => setConfirm({ title: `${item.disabled ? '启用' : '禁用'} ${item.username}？`, description: item.disabled ? '该用户将可以重新登录。' : '现有登录会话将失效，用户数据会保留。', successMessage: item.disabled ? '用户已启用' : '用户已禁用', action: () => api.manageUser(item.id, { disabled: !item.disabled }) })}>{item.disabled ? <CircleCheck /> : <Ban />}</MacButton></MacTooltip>
      <MacTooltip content="删除"><MacButton variant="icon" className="record-delete" aria-label={`删除 ${item.username}`} onClick={() => setConfirm({ title: `删除 ${item.username}？`, description: '将永久删除此用户、个人分类、站点及其共享站点，无法撤销。', successMessage: '用户已删除', action: () => api.deleteUser(item.id) })}><Trash2 /></MacButton></MacTooltip>
    </div> },
  ];
  return <>
    <MacTable label="用户管理" minWidth={520} columns={columns} rows={items} rowKey={item => item.id} loading={loading} error={error}
      emptyText="没有匹配的用户" footer={<Pagination page={page} total={total} busy={loading} onPage={setPage} />} />
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
