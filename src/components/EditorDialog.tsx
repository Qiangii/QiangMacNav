import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { DesktopAccountContext, clearDesktopCacheEntry, editorCacheKey, isCachedText, isRecord, readDesktopCache, writeDesktopCache } from '../desktopCache';
import { api, message } from '../api';
import type { Category, Site } from '../types';
import { MacButton, MacFormDialog, MacInput, MacSelect, MacTextarea, notify } from './ui';
import { ImagePickerDialog } from './ImagePickerDialog';
import { MacPresence } from './ui/MacPresence';
import { MediaPreview } from './MediaPreview';
import { ImageIcon } from 'lucide-react';

export type EditorTarget = { kind: 'site'; site?: Site; categoryId?: string | null } | { kind: 'category'; category?: Category };

export function EditorDialog({ target, categories, onSave, onClose, onBusyChange }: {
  target: EditorTarget;
  categories: Category[];
  onSave: () => Promise<void>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const account = useContext(DesktopAccountContext);
  const iconInputId = useId();
  const cacheKey = editorCacheKey(target);
  const finished = useRef(false);
  const [cached] = useState(() => {
    const value = readDesktopCache(account, cacheKey);
    return isRecord(value) ? value : {};
  });
  const text = (key: string, fallback: string) => isCachedText(cached[key]) ? cached[key] as string : fallback;
  const [name, setName] = useState(() => text('name', target.kind === 'site' ? target.site?.name ?? '' : target.category?.name ?? ''));
  const [url, setUrl] = useState(() => text('url', target.kind === 'site' ? target.site?.url ?? '' : ''));
  const [note, setNote] = useState(() => text('note', target.kind === 'site' ? target.site?.note ?? '' : ''));
  const [logoUrl, setLogoUrl] = useState(() => text('logoUrl', target.kind === 'site' ? target.site?.logoUrl ?? '' : target.category?.iconUrl ?? ''));
  const [categoryId, setCategoryId] = useState(() => {
    const id = text('categoryId', target.kind === 'site' ? target.site?.categoryId ?? target.categoryId ?? '' : '');
    return categories.some(c => c.id === id && c.editable) ? id : '';
  });
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false), [pickerBusy, setPickerBusy] = useState(false);
  useEffect(() => {
    const deleted = (event: Event) => { const url = (event as CustomEvent<string>).detail; setLogoUrl(previous => previous === url ? '' : previous); };
    window.addEventListener('harbor-media-deleted', deleted);
    return () => window.removeEventListener('harbor-media-deleted', deleted);
  }, []);
  useLayoutEffect(() => {
    if (!finished.current) writeDesktopCache(account, cacheKey, { name, url, note, logoUrl, categoryId });
  }, [account, cacheKey, name, url, note, logoUrl, categoryId]);
  function close() { finished.current = true; clearDesktopCacheEntry(account, cacheKey); onClose(); }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || pickerOpen) return;
    setBusy(true); onBusyChange(true);
    try {
      if (target.kind === 'category') {
        if (target.category) await api.updateCategory(target.category.id, name, logoUrl);
        else await api.createCategory(name, logoUrl);
      } else {
        const value = { name, url, note, logoUrl, categoryId: categoryId || null };
        if (target.site) await api.updateSite(target.site.id, value);
        else await api.createSite(value);
      }
      const success = target.kind === 'category' ? target.category ? '分类已更新' : '分类已创建' : target.site ? '网站已更新' : '网站已添加';
      // The write has succeeded. A failed reload must not leave this form able
      // to submit the same creation again.
      try { await onSave(); notify(success); }
      catch { notify(`${success}，但列表刷新失败，请刷新页面`, 'error'); }
      onBusyChange(false);
      close();
    } catch (reason) { notify(message(reason), 'error'); }
    finally { setBusy(false); onBusyChange(false); }
  }

  const isSite = target.kind === 'site';
  return <><MacFormDialog onClose={close} busy={busy || pickerBusy} label={isSite ? '编辑网站' : '编辑分类'} title={isSite ? target.site ? '编辑网站' : '添加网站' : target.category ? '编辑分类' : '新建分类'}>
      <form onSubmit={save} className="editor-form">
        <label>名称<MacInput autoFocus required maxLength={isSite ? 100 : 80} value={name} onChange={e => setName(e.target.value)} placeholder={isSite ? '网站名称' : '分类名称'} /></label>
        {isSite && <>
          <label>网址<MacInput required type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" /></label>
          <label>备注<MacTextarea maxLength={500} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="写下网站用途或备注" /></label>
          <MacSelect label="所属分类" value={categoryId} onChange={setCategoryId} options={[{ value: '', label: '未分类' }, ...categories.filter(c => c.editable).map(c => ({ value: c.id, label: c.name + (c.shared ? ' · 共享' : '') }))]} />
        </>}
        <div className="editor-icon-field">
          <label htmlFor={iconInputId}>图标地址</label>
          <div className="editor-icon-controls">
            <span className="editor-icon-preview" aria-hidden="true"><MediaPreview url={logoUrl} fallback={<ImageIcon size={17} />} /></span>
            <MacInput id={iconInputId} aria-describedby={`${iconInputId}-hint`} type="text" maxLength={2048} value={logoUrl} onChange={event => setLogoUrl(event.target.value)} placeholder="粘贴图片链接" />
            <MacButton variant="secondary" disabled={busy} onClick={() => setPickerOpen(true)}>选择图标</MacButton>
          </div>
          <p id={`${iconInputId}-hint`} className="editor-icon-hint">{isSite ? '留空时使用网站默认图标' : '留空时使用默认文件夹图标'}</p>
        </div>
        <div className="dialog-actions"><MacButton variant="secondary" disabled={busy} onClick={close}>取消</MacButton><MacButton type="submit" variant="primary" disabled={busy}>{busy ? '正在保存...' : '保存'}</MacButton></div>
      </form>
  </MacFormDialog>
    <MacPresence open={pickerOpen}><ImagePickerDialog title="选择图标" value={logoUrl} onClose={() => setPickerOpen(false)} onBusyChange={value => { setPickerBusy(value); onBusyChange(value); }} onSelect={async url => setLogoUrl(url)} /></MacPresence>
  </>;
}
