import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Search, Trash2, Upload } from 'lucide-react';
import { api, message } from '../api';
import type { IconCatalog, MediaImage, MediaKind } from '../types';
import { MacAlertDialog, MacButton, MacFormDialog, MacInput, MacScrollArea, notify } from './ui';
import { MacPresence } from './ui/MacPresence';
import { MediaPreview } from './MediaPreview';
import './image-picker.css';

const catalogRequests: Partial<Record<MediaKind, Promise<IconCatalog>>> = {};
function loadCatalog(kind: MediaKind) {
  if (kind === 'wallpaper') return Promise.resolve({ categories: [], items: [] } as IconCatalog);
  return catalogRequests[kind] ??= fetch(`/assets/${kind === 'avatar' ? 'avatars' : 'icons'}/catalog.json`).then(response => {
    if (!response.ok) throw new Error(kind === 'avatar' ? '默认头像加载失败' : '图标库加载失败');
    return response.json() as Promise<IconCatalog>;
  }).catch(error => { delete catalogRequests[kind]; throw error; });
}

// Stores URLs only. The same picker can serve avatars, site/category icons and wallpapers.
// Consumers decide when/how the selected URL is persisted through onSelect.
export function ImagePickerDialog({ title = '选择图片', value = '', valueMime = '', onSelect, onClose, allowUpload = true, categories, kind = 'image', onBusyChange }: {
  title?: string; value?: string; valueMime?: string; onSelect: (url: string, media?: MediaImage) => Promise<void>;
  onClose: () => void; allowUpload?: boolean; categories?: string[]; kind?: MediaKind; onBusyChange?: (busy: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<IconCatalog>();
  const [category, setCategory] = useState(kind === 'wallpaper' ? 'uploads' : 'all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(value);
  const [images, setImages] = useState<MediaImage[]>([]);
  const [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<MediaImage>();
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  useEffect(() => { busyCallback.current?.(busy); }, [busy]);
  useEffect(() => () => busyCallback.current?.(false), []);
  useEffect(() => {
    let active = true;
    loadCatalog(kind).then(result => { if (active) setCatalog(result); }).catch(reason => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [reload, kind]);
  useEffect(() => {
    if (category !== 'uploads') return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api.media(page, query, kind, controller.signal).then(result => {
        if (!active) return;
        setImages(previous => page === 1 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.id === item.id))]);
        setTotal(result.total);
      }).catch(reason => { if (active) setError(message(reason)); }).finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [category, page, query, reload, kind]);

  async function upload(file?: File) {
    if (!file) return;
    const isVideo = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
    if (isVideo && kind !== 'wallpaper') { notify('请选择图片，MP4 仅用于壁纸', 'error'); return; }
    if (file.size > (isVideo ? 50 : 8) * 1024 * 1024) { notify(isVideo ? 'MP4 不能超过 50 MB' : '图片不能超过 8 MB', 'error'); return; }
    setBusy(true); setError('');
    try {
      const image = await api.uploadImage(file, kind);
      setSelected(image.url); setQuery(''); setPage(1); setCategory('uploads');
      setImages([image]); setReload(previous => previous + 1);
      notify(kind === 'avatar' ? '头像已上传' : kind === 'wallpaper' ? '壁纸已上传' : '图片已上传');
    } catch (reason) { notify(message(reason), 'error'); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function save() {
    setBusy(true); setError('');
    try { await onSelect(selected, images.find(image => image.url === selected)); onClose(); }
    catch (reason) { notify(message(reason), 'error'); }
    finally { setBusy(false); }
  }
  const groups = catalog?.categories.filter(group => !categories || categories.includes(group.id)) ?? [];
  const selectedMime = images.find(image => image.url === selected)?.mime ?? (selected === value ? valueMime : '');
  async function remove(image: MediaImage) {
    setBusy(true);
    try {
      await api.deleteMedia(image.id);
      setImages(previous => previous.filter(item => item.id !== image.id));
      if (selected === image.url) setSelected('');
      setPage(1); setReload(previous => previous + 1);
    } finally { setBusy(false); }
  }
  const items = category === 'uploads' ? images : (catalog?.items ?? []).filter(item =>
    (!categories || categories.includes(item.category)) && (category === 'all' || item.category === category) &&
    `${item.name} ${item.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const isAvatar = kind === 'avatar';
  return <><MacFormDialog title={title} busy={busy} className={`image-picker${isAvatar ? ' avatar-picker' : ''}`} onClose={onClose}>
    <div className="image-picker-categories" role="group" aria-label={isAvatar ? '头像分类' : '图片分类'}>
      {[...(kind === 'wallpaper' ? [] : [{ id: 'all', name: isAvatar ? '默认头像' : '全部图标' }, ...groups]), ...(allowUpload ? [{ id: 'uploads', name: isAvatar ? '我的头像' : '我的上传' }] : [])].map(group =>
        <MacButton key={group.id} variant="secondary" aria-pressed={category === group.id} disabled={busy} onClick={() => { setCategory(group.id); setQuery(''); setPage(1); setError(''); }}>{group.name}</MacButton>)}
    </div>
    <div className="image-picker-toolbar">
      <label><Search size={14} /><MacInput autoFocus aria-label={isAvatar ? '搜索头像' : '搜索图片'} placeholder={isAvatar ? '搜索头像名称' : category === 'uploads' ? '搜索上传的图片' : '搜索图标名称'} value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      {allowUpload && <MacButton variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={13} />{isAvatar ? '上传头像' : kind === 'wallpaper' ? '上传壁纸' : '上传图片'}</MacButton>}
      <input ref={fileInput} type="file" accept={`image/png,image/jpeg,image/webp,image/gif${kind === 'wallpaper' ? ',video/mp4' : ''}`} hidden onChange={event => { void upload(event.target.files?.[0]); }} />
    </div>
    {error && <div className="image-picker-error" role="alert">{error}<MacButton variant="secondary" disabled={busy} onClick={() => { setError(''); setReload(previous => previous + 1); }}>重试</MacButton></div>}
    <MacScrollArea className="image-picker-results" aria-label={isAvatar ? '头像库' : '图片库'} aria-busy={loading}>
      <div className="image-picker-grid">{items.map(item => <div key={item.id} className="media-tile">
        <MacButton className="image-picker-item" disabled={busy} aria-label={item.name} aria-pressed={selected === item.url} onClick={() => setSelected(item.url)}>
          <MediaPreview url={item.url} mime={'mime' in item ? item.mime : ''} loading="lazy" /><span>{item.name}</span>{selected === item.url && <Check className="image-picker-check" size={13} />}
        </MacButton>
        {category === 'uploads' && 'mime' in item && <MacButton className="media-delete" aria-label={`删除 ${item.name}`} disabled={busy} onClick={() => setDeleting(item)}><Trash2 size={13} /></MacButton>}
      </div>)}</div>
      {!items.length && <p className="image-picker-empty">{loading || (category !== 'uploads' && !catalog) ? '正在加载…' : query ? isAvatar ? '没有找到匹配的头像' : '没有找到匹配的图片' : isAvatar ? '上传头像后，可在这里选择和删除' : '上传图片后会保存在这里'}</p>}
      {category === 'uploads' && images.length < total && <MacButton variant="secondary" disabled={loading || busy} onClick={() => setPage(previous => previous + 1)}>{loading ? '正在加载…' : '加载更多'}</MacButton>}
    </MacScrollArea>
    <footer className="image-picker-footer">
      <span className="image-picker-preview"><MediaPreview url={selected} mime={selectedMime} alt={isAvatar ? '已选头像' : '已选图片'} play fallback={<ImagePlus size={24} />} /></span>
      <MacButton variant="secondary" disabled={busy} onClick={() => setSelected('')}>{isAvatar ? '使用首字头像' : '使用默认'}</MacButton>
      <span className="image-picker-hint">{kind === 'wallpaper' ? '图片 / GIF ≤ 8 MB · MP4 ≤ 50 MB' : 'PNG / JPEG / WebP / GIF · 最大 8 MB'}</span>
      <MacButton variant="primary" disabled={busy || loading} onClick={() => { void save(); }}>{busy ? '正在保存…' : isAvatar ? '使用头像' : kind === 'wallpaper' ? '使用壁纸' : '使用图片'}</MacButton>
    </footer>
  </MacFormDialog>
    <MacPresence open={!!deleting}>{deleting && <MacAlertDialog title={`删除“${deleting.name}”？`} description={isAvatar ? '这张头像会被永久删除。如果正在使用，将恢复为首字头像。' : '文件会从本地存储中永久删除，正在使用它的壁纸和图标会恢复默认。'} successMessage={isAvatar ? '头像已删除' : kind === 'wallpaper' ? '壁纸已删除' : '图片已删除'} onConfirm={() => remove(deleting)} onClose={() => setDeleting(undefined)} />}</MacPresence>
  </>;
}
