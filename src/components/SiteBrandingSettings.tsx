import { useEffect, useState, type FormEvent } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { api, message } from '../api';
import type { SiteBranding } from '../types';
import { DEFAULT_BRANDING } from '../branding';
import { ImagePickerDialog } from './ImagePickerDialog';
import { MediaPreview } from './MediaPreview';
import { MacButton, MacInput, MacPresence, useNotify } from './ui';
import './site-branding.css';

export function SiteBrandingSettings({ value, onSaved, disabled }: { value: SiteBranding; onSaved: (value: SiteBranding) => void; disabled: boolean }) {
  const notify = useNotify();
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false), [pickerOpen, setPickerOpen] = useState(false), [pickerBusy, setPickerBusy] = useState(false);
  useEffect(() => { setDraft(value); }, [value.siteTitle, value.siteLogoUrl]);
  useEffect(() => {
    const deleted = (event: Event) => { const url = (event as CustomEvent<string>).detail; setDraft(previous => previous.siteLogoUrl === url ? { ...previous, siteLogoUrl: DEFAULT_BRANDING.siteLogoUrl } : previous); };
    window.addEventListener('harbor-media-deleted', deleted);
    return () => window.removeEventListener('harbor-media-deleted', deleted);
  }, []);
  const locked = disabled || busy || pickerBusy;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked || pickerOpen) return;
    const siteTitle = draft.siteTitle.trim();
    if (!siteTitle || [...siteTitle].length > 60) { notify('网站名称须为 1–60 个字符', 'error'); return; }
    setBusy(true);
    try {
      const saved = await api.updateBranding({ siteTitle, siteLogoUrl: draft.siteLogoUrl.trim() });
      const branding = { siteTitle: saved.siteTitle, siteLogoUrl: saved.siteLogoUrl };
      setDraft(branding); onSaved(branding); notify('网站信息已保存');
    } catch (reason) { notify(message(reason), 'error'); }
    finally { setBusy(false); }
  }
  return <>
    <h3 className="settings-subheading">网站信息</h3>
    <form className="site-branding-form" aria-label="网站信息" aria-busy={busy || pickerBusy} onSubmit={save}>
      <div className="site-branding-overview">
        <span className="site-branding-preview"><MediaPreview url={draft.siteLogoUrl || DEFAULT_BRANDING.siteLogoUrl} alt="网站 Logo 预览" fallback={<img src={DEFAULT_BRANDING.siteLogoUrl} alt="默认 Logo" />} /></span>
        <div className="site-branding-identity"><strong title={draft.siteTitle.trim() || DEFAULT_BRANDING.siteTitle}>{draft.siteTitle.trim() || DEFAULT_BRANDING.siteTitle}</strong><span>登录页 · 浏览器标题 · 标签页图标</span></div>
        <MacButton className="site-branding-choose" variant="secondary" disabled={locked} onClick={() => setPickerOpen(true)}><ImagePlus size={14} aria-hidden="true" />选择 Logo</MacButton>
      </div>
      <div className="site-branding-fields">
        <label className="site-branding-field"><span>网站名称</span><MacInput value={draft.siteTitle} maxLength={60} disabled={locked} placeholder={DEFAULT_BRANDING.siteTitle} onChange={event => setDraft({ ...draft, siteTitle: event.target.value })} /></label>
        <label className="site-branding-field"><span>网站 Logo 地址</span><MacInput value={draft.siteLogoUrl} maxLength={2048} disabled={locked} placeholder="输入图片地址，或选择图片" aria-describedby="site-branding-logo-help" onChange={event => setDraft({ ...draft, siteLogoUrl: event.target.value })} /></label>
        <p id="site-branding-logo-help" className="site-branding-field-help">支持图片链接，也可选择内置图标或上传图片。</p>
      </div>
      <div className="site-branding-footer"><p>保存后对所有人显示，上传图片会保存为独立的网站 Logo。</p><div className="site-branding-actions"><MacButton variant="secondary" disabled={locked} onClick={() => setDraft(DEFAULT_BRANDING)}><RotateCcw size={13} aria-hidden="true" />恢复默认</MacButton><MacButton type="submit" variant="primary" disabled={locked || pickerOpen}>{busy ? '正在保存…' : '保存网站信息'}</MacButton></div></div>
    </form>
    <MacPresence open={pickerOpen}><ImagePickerDialog title="选择网站 Logo" kind="image" value={draft.siteLogoUrl} onClose={() => setPickerOpen(false)} onBusyChange={setPickerBusy} onSelect={async siteLogoUrl => setDraft(previous => ({ ...previous, siteLogoUrl }))} /></MacPresence>
  </>;
}
