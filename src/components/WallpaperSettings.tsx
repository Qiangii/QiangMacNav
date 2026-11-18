import { useEffect, useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { api, message } from '../api';
import type { MediaImage, Preferences } from '../types';
import { WALLPAPERS } from '../visuals';
import { MacAlertDialog, MacButton, notify } from './ui';
import { MacPresence } from './ui/MacPresence';
import { MediaPreview } from './MediaPreview';
import './wallpapers.css';

export function WallpaperSettings({ preferences, onChange }: { preferences: Preferences; onChange: (value: Preferences, successMessage?: string, errorContext?: string) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MediaImage[]>([]), [total, setTotal] = useState(0);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [deleting, setDeleting] = useState<MediaImage>();
  useEffect(() => {
    const changed = () => { setPage(1); setRevision(value => value + 1); };
    window.addEventListener('harbor-media-deleted', changed);
    return () => window.removeEventListener('harbor-media-deleted', changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true; setLoading(true);
    api.media(page, '', 'wallpaper', controller.signal).then(result => {
      if (active) { setTotal(result.total); setItems(previous => page === 1 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.id === item.id))]); }
    }).catch(reason => { if (active) setError(message(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [page, revision]);
  async function change(value: Preferences) {
    setBusy(true); setError('');
    try { await onChange(value, '壁纸已更新'); } catch { /* The preference save owns error feedback. */ }
    finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    const video = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
    if (file.size > (video ? 50 : 8) * 1024 * 1024) { notify(video ? 'MP4 不能超过 50 MB' : '图片不能超过 8 MB', 'error'); return; }
    setBusy(true); setError('');
    let uploaded = false;
    try {
      const item = await api.uploadImage(file, 'wallpaper');
      uploaded = true;
      setPage(1); setRevision(value => value + 1);
      await onChange({ ...preferences, wallpaperUrl: item.url, wallpaperMime: item.mime }, '壁纸已上传并应用', '壁纸已上传，但应用失败，可在列表中重新选择');
    } catch (reason) { if (!uploaded) notify(message(reason), 'error'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return <div aria-busy={busy}>
    <div className="wallpaper-grid">
      {Object.entries(WALLPAPERS).map(([id, wall]) => <MacButton key={id} disabled={busy} className={`wallpaper-builtin${!preferences.wallpaperUrl && preferences.wallpaper === id ? ' selected' : ''}`} onClick={() => change({ ...preferences, wallpaper: id as Preferences['wallpaper'], wallpaperUrl: '', wallpaperMime: '' })}><span style={{ backgroundImage: `url(${wall.image})` }} /><b>{wall.label}</b>{'video' in wall && <small className="wallpaper-format">动态</small>}</MacButton>)}
      {items.map(item => <div key={item.id} className="media-tile wallpaper-tile">
        <MacButton className={preferences.wallpaperUrl === item.url ? 'selected' : ''} disabled={busy} aria-label={`使用壁纸 ${item.name}`} onClick={() => change({ ...preferences, wallpaperUrl: item.url, wallpaperMime: item.mime })}>
          <span><MediaPreview url={item.url} mime={item.mime} loading="lazy" /></span><b>{item.name}</b>
          {(item.mime === 'video/mp4' || item.mime === 'image/gif') && <small className="wallpaper-format">{item.mime === 'video/mp4' ? 'MP4' : 'GIF'}</small>}
        </MacButton>
        <MacButton className="media-delete" aria-label={`删除壁纸 ${item.name}`} disabled={busy} onClick={() => setDeleting(item)}><Trash2 size={13} /></MacButton>
      </div>)}
      {items.length < total && <MacButton className="wallpaper-more" disabled={busy || loading} onClick={() => setPage(value => value + 1)}><span>{loading ? '正在加载…' : '加载更多'}</span></MacButton>}
      <MacButton className="wallpaper-upload" aria-label="上传壁纸" disabled={busy} onClick={() => input.current?.click()}><span><Upload size={24} /><b>{busy ? '正在处理…' : '上传壁纸'}</b></span></MacButton>
    </div>
    <input hidden ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4" onChange={event => { void upload(event.target.files?.[0]); }} />
    {error && <p className="settings-error" role="alert">{error}</p>}
    <MacPresence open={!!deleting}>{deleting && <MacAlertDialog title={`删除“${deleting.name}”？`} description="文件会从本地存储中永久删除，正在使用它的头像、壁纸和图标会恢复默认。" successMessage="壁纸已删除" onClose={() => setDeleting(undefined)} onConfirm={async () => { setBusy(true); try { await api.deleteMedia(deleting.id); } finally { setBusy(false); } }} />}</MacPresence>
  </div>;
}
