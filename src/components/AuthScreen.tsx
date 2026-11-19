import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { dismissNotifications, useViewFeedback } from '../viewFeedback';
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react';
import { api, message } from '../api';
import { validPassword, validPasswordLength, validUsername, PASSWORD_HINT, PASSWORD_LENGTH_HINT, USERNAME_HINT, PASSWORD_PLACEHOLDER, USERNAME_PLACEHOLDER } from '../accountValidation';
import type { Bootstrap, User } from '../types';
import { WALLPAPERS } from '../visuals';
import { MacButton, MacInput } from './ui';
import { DEFAULT_BRANDING } from '../branding';

export function AuthScreen({ bootstrap, onSuccess, onRefresh }: {
  bootstrap: Bootstrap;
  onSuccess: (user: User) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'login' | 'register'>(bootstrap.setupRequired ? 'register' : 'login');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useViewFeedback('');
  const [invalidField, setInvalidField] = useViewFeedback<'username' | 'password' | null>(null);
  useLayoutEffect(dismissNotifications, [mode]);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => new Date());
  const registerAvailable = bootstrap.setupRequired || bootstrap.registrationEnabled;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (bootstrap.setupRequired) setMode('register');
    else if (!bootstrap.registrationEnabled) setMode('login');
  }, [bootstrap.setupRequired, bootstrap.registrationEnabled]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!validUsername(username.trim())) { setInvalidField('username'); setError(USERNAME_HINT); usernameInput.current?.focus(); return; }
    if (mode === 'register' && !validPassword(password)) { setInvalidField('password'); setError(PASSWORD_HINT); passwordInput.current?.focus(); return; }
    if (mode === 'login' && !validPasswordLength(password)) { setInvalidField('password'); setError(PASSWORD_LENGTH_HINT); passwordInput.current?.focus(); return; }
    setBusy(true);
    setError('');
    setInvalidField(null);
    try {
      const account = mode === 'register'
        ? await api.register(name, username, password, bootstrap.setupTokenRequired ? setupToken : '')
        : await api.login(username, password);
      await onSuccess(account);
    } catch (reason) {
      setError(message(reason));
      await onRefresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  return <main className="lock-screen" style={{ '--lock-wallpaper': `url("${WALLPAPERS.coast.image}")` } as React.CSSProperties}>
    <div className="lock-wallpaper" />
    <div className="lock-clock" aria-label="当前时间">
      <span>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now)}</span>
      <strong>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}</strong>
    </div>
    <section className="lock-account" aria-label="账户">
      <img className="lock-brand-logo" src={bootstrap.siteLogoUrl || DEFAULT_BRANDING.siteLogoUrl} alt="网站 Logo" onError={event => { if (event.currentTarget.getAttribute('src') !== DEFAULT_BRANDING.siteLogoUrl) event.currentTarget.src = DEFAULT_BRANDING.siteLogoUrl; }} />
      <div className="lock-account-name">{bootstrap.siteTitle || DEFAULT_BRANDING.siteTitle}</div>
      <h1>{bootstrap.setupRequired ? '创建管理员' : mode === 'login' ? '登录到桌面' : '创建账户'}</h1>
      {!bootstrap.setupRequired && registerAvailable && <div className="lock-tabs" role="tablist" aria-label="认证方式">
        <MacButton role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setError(''); setInvalidField(null); }}>登录</MacButton>
        <MacButton role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError(''); setInvalidField(null); }}>注册</MacButton>
      </div>}
      <form onSubmit={submit} className="lock-form" onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}>
        {mode === 'register' && <label><UserRound size={16} /><MacInput autoComplete="name" aria-label="显示名称" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={60} placeholder="请输入显示名称" /></label>}
        <label className={invalidField === 'username' ? 'is-invalid' : undefined}><UserRound size={16} /><MacInput ref={usernameInput} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-label="账号" aria-invalid={invalidField === 'username' || undefined} aria-describedby={invalidField === 'username' ? 'auth-error' : undefined} value={username} onChange={e => { setUsername(e.target.value); if (invalidField === 'username') { setInvalidField(null); setError(''); } }} required title={USERNAME_HINT} placeholder={USERNAME_PLACEHOLDER} /></label>
        <label className={invalidField === 'password' ? 'is-invalid' : undefined}><LockKeyhole size={16} /><MacInput ref={passwordInput} type={showPassword ? 'text' : 'password'} aria-label="密码" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => { setPassword(e.target.value); if (invalidField === 'password') { setInvalidField(null); setError(''); } }} required aria-invalid={invalidField === 'password' || undefined} aria-describedby={invalidField === 'password' ? 'auth-error' : undefined} placeholder={PASSWORD_PLACEHOLDER} /><MacButton type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</MacButton></label>
        {bootstrap.setupRequired && bootstrap.setupTokenRequired && <label><LockKeyhole size={16} /><MacInput value={setupToken} onChange={e => setSetupToken(e.target.value)} aria-label="初始化密钥" required placeholder="请输入初始化密钥" /></label>}
        {error && <p id="auth-error" className="lock-error" role="alert">{error}</p>}
        <MacButton type="submit" className="lock-submit" disabled={busy}>{busy ? (mode === 'login' ? '正在登录…' : '正在创建账户…') : bootstrap.setupRequired ? '创建管理员账户' : mode === 'login' ? '登录' : '创建账户'}<ArrowRight size={17} /></MacButton>
      </form>
    </section>
  </main>;
}
