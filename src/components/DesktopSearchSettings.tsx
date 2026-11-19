import { useEffect, useId, useRef, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { message } from '../api';
import type { Preferences, SearchEngine } from '../types';
import { MacAlertDialog, MacButton, MacFormDialog, MacInput, MacPresence, MacSwitch, MacTooltip, useNotify } from './ui';
import { DEFAULT_DESKTOP_SEARCH, searchEngineError } from './desktopSearch';
import { useNavigationDrag, useNavigationSensors } from './navigationDrag';
import { ImagePickerDialog } from './ImagePickerDialog';
import { MediaPreview } from './MediaPreview';
import './desktop-search.css';

export function SearchEngineIcon({ engine }: { engine: SearchEngine }) {
  const defaultIcon = DEFAULT_DESKTOP_SEARCH.engines.find(item => item.id === engine.id)?.iconUrl;
  const fallback = <MediaPreview url={defaultIcon} fallback={[...engine.name][0]} />;
  return <span className="search-engine-icon" aria-hidden="true" draggable={false} onDragStart={event => event.preventDefault()}>
    <MediaPreview url={engine.iconUrl} fallback={fallback} />
  </span>;
}

const verticalEngineList: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => ({
  ...transform, x: 0,
  y: draggingNodeRect && containerNodeRect
    ? Math.max(containerNodeRect.top - draggingNodeRect.top, Math.min(transform.y, containerNodeRect.bottom - draggingNodeRect.bottom))
    : transform.y,
});
const engineListModifiers = [verticalEngineList];

function SortableEngine({ engine, disabled, dragging, onEdit, onDelete }: {
  engine: SearchEngine; disabled: boolean; dragging: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: engine.id, disabled });
  return <div ref={setNodeRef} role="listitem" className={`setting-row search-engine-row${isDragging ? ' is-sorting' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <MacTooltip content="拖动调整顺序；空格开始，上下键移动" disabled={dragging || disabled}><MacButton ref={setActivatorNodeRef} className="search-engine-grip" aria-label={`调整 ${engine.name} 顺序`} disabled={disabled} {...attributes} {...listeners}><GripVertical size={14} /></MacButton></MacTooltip>
    <SearchEngineIcon engine={engine} /><div className="search-engine-details"><strong>{engine.name}</strong><MacTooltip content={engine.url} disabled={dragging}><span>{engine.url}</span></MacTooltip></div>
    <div className="search-engine-actions"><MacButton variant="secondary" aria-label={`编辑 ${engine.name}`} disabled={disabled || dragging} onClick={onEdit}><Pencil size={13} /></MacButton><MacButton variant="secondary" aria-label={`删除 ${engine.name}`} disabled={disabled || dragging} onClick={onDelete}><Trash2 size={13} /></MacButton></div>
  </div>;
}

function EngineEditor({ engine, onSave, onClose }: { engine: SearchEngine; onSave: (engine: SearchEngine) => Promise<boolean>; onClose: () => void }) {
  const notify = useNotify();
  const urlHintId = useId();
  const iconInputId = useId();
  const [draft, setDraft] = useState(engine), [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false), [pickerBusy, setPickerBusy] = useState(false);
  useEffect(() => {
    const deleted = (event: Event) => { const url = (event as CustomEvent<string>).detail; setDraft(previous => previous.iconUrl === url ? { ...previous, iconUrl: '' } : previous); };
    window.addEventListener('harbor-media-deleted', deleted);
    return () => window.removeEventListener('harbor-media-deleted', deleted);
  }, []);
  async function save() {
    if (busy || pickerOpen || pickerBusy) return;
    const value = { ...draft, name: draft.name.trim(), url: draft.url.trim(), iconUrl: draft.iconUrl?.trim() ?? '' };
    const invalid = searchEngineError(value);
    if (invalid) { notify(invalid, 'error'); return; }
    setBusy(true);
    try { if (await onSave(value)) onClose(); }
    finally { setBusy(false); }
  }
  return <><MacFormDialog title={engine.name ? '编辑搜索引擎' : '添加搜索引擎'} className="search-engine-dialog" busy={busy || pickerBusy} onClose={onClose}>
    <form className="editor-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>搜索名称<MacInput autoFocus aria-label="搜索名称" value={draft.name} maxLength={32} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：百度" /></label>
      <div>
        <label>搜索链接<MacInput aria-label="搜索链接" aria-describedby={urlHintId} value={draft.url} maxLength={2048} disabled={busy} onChange={event => setDraft({ ...draft, url: event.target.value })} placeholder="https://www.baidu.com/s?wd={query}" /></label>
        <p id={urlHintId} className="search-engine-help">在搜索链接中用 {'{query}'} 代表输入的关键词。</p>
      </div>
      <div className="editor-icon-field">
        <label htmlFor={iconInputId}>图标地址</label>
        <div className="editor-icon-controls">
          <span className="editor-icon-preview" aria-hidden="true"><SearchEngineIcon engine={draft} /></span>
          <MacInput id={iconInputId} aria-describedby={`${iconInputId}-hint`} type="text" maxLength={2048} value={draft.iconUrl ?? ''} disabled={busy || pickerBusy} onChange={event => setDraft({ ...draft, iconUrl: event.target.value })} placeholder="粘贴图片链接" />
          <MacButton variant="secondary" disabled={busy || pickerBusy} onClick={() => setPickerOpen(true)}>选择图标</MacButton>
        </div>
        <p id={`${iconInputId}-hint`} className="editor-icon-hint">留空时使用搜索引擎默认图标</p>
      </div>
      <div className="dialog-actions"><MacButton variant="secondary" disabled={busy} onClick={onClose}>取消</MacButton><MacButton type="submit" variant="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</MacButton></div>
    </form>
  </MacFormDialog>
    <MacPresence open={pickerOpen}><ImagePickerDialog title="选择图标" kind="image" value={draft.iconUrl ?? ''} onClose={() => setPickerOpen(false)} onBusyChange={setPickerBusy} onSelect={async iconUrl => setDraft(previous => ({ ...previous, iconUrl }))} /></MacPresence>
  </>;
}

export function DesktopSearchSettings({ preferences, busy, hidden, onChange }: { preferences: Preferences; busy: boolean; hidden: boolean; onChange: (value: Preferences, successMessage?: string) => Promise<boolean> }) {
  const notify = useNotify();
  const config = preferences.desktopSearch ?? DEFAULT_DESKTOP_SEARCH;
  const [editing, setEditing] = useState<SearchEngine>(), [deleting, setDeleting] = useState<SearchEngine>();
  const [active, setActive] = useState<string>();
  const [draft, setDraft] = useState<SearchEngine[]>();
  const session = useRef<SearchEngine[] | undefined>(undefined);
  const saving = useRef(false);
  const drag = useNavigationDrag('handle');
  const sensors = useNavigationSensors('handle', 'sidebar');
  const displayed = draft ?? config.engines;
  const locked = busy || !!draft || !!active;
  useEffect(() => {
    // A hidden settings window or a newer configuration invalidates this gesture.
    if (session.current && (hidden || busy || session.current !== config.engines)) {
      session.current = undefined; setActive(undefined); drag.end();
    }
  }, [hidden, busy, config.engines, drag]);
  function cancelSort() { session.current = undefined; setActive(undefined); drag.end(); }
  async function finishSort({ active: moving, over }: DragEndEvent) {
    const origin = session.current;
    cancelSort();
    if (!origin || hidden || busy || saving.current || origin !== config.engines || !over || moving.id === over.id) return;
    const from = origin.findIndex(engine => engine.id === moving.id), to = origin.findIndex(engine => engine.id === over.id);
    if (from < 0 || to < 0) return;
    const engines = arrayMove(origin, from, to);
    saving.current = true; setDraft(engines);
    try { await onChange({ ...preferences, desktopSearch: { ...config, engines } }, '搜索引擎顺序已保存'); }
    catch (error) { notify(message(error), 'error'); }
    finally { saving.current = false; setDraft(undefined); }
  }
  return <>
    <h3 className="settings-subheading">桌面搜索</h3>
    <div className="settings-list">
      <div className="setting-row"><div><strong>桌面搜索框</strong><span>在桌面显示可拖动的网页搜索框</span></div><MacSwitch aria-label="桌面搜索框" checked={config.enabled} disabled={locked} onChange={event => { void onChange({ ...preferences, desktopSearch: { ...config, enabled: event.target.checked } }); }} /></div>
    </div>
    {config.enabled && <>
      <div className="search-settings-heading"><h3 className="settings-subheading">搜索配置</h3><MacButton variant="secondary" disabled={locked || config.engines.length >= 12} onClick={() => setEditing({ id: `engine-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, name: '', url: '' })}><Plus size={13} />添加搜索引擎</MacButton></div>
      <DndContext sensors={sensors} modifiers={engineListModifiers} collisionDetection={closestCenter}
        accessibility={{ screenReaderInstructions: { draggable: '按空格开始调整搜索引擎顺序，上下方向键移动，再按空格或回车保存，Esc 取消。' }, announcements: {
          onDragStart: ({ active }) => `开始移动 ${config.engines.find(engine => engine.id === active.id)?.name ?? '搜索引擎'}。`,
          onDragOver: ({ over }) => over ? `目标位置：第 ${config.engines.findIndex(engine => engine.id === over.id) + 1} 项，共 ${config.engines.length} 项。` : undefined,
          onDragEnd: () => '排序移动结束。', onDragCancel: () => '已取消排序，顺序保持不变。',
        } }}
        onDragStart={({ active }) => {
          if (busy || hidden || saving.current || editing || deleting) return;
          session.current = config.engines; setActive(String(active.id)); drag.begin();
        }} onDragCancel={cancelSort} onDragEnd={event => { void finishSort(event); }}>
        <div className="settings-list search-engine-list" role="list" aria-label="搜索引擎顺序" aria-busy={locked} onClickCapture={drag.guard} onContextMenuCapture={drag.guard}>
          <SortableContext items={displayed.map(engine => engine.id)} strategy={verticalListSortingStrategy}>
            {displayed.map(engine => <SortableEngine key={engine.id} engine={engine} disabled={busy || !!draft || hidden || !!editing || !!deleting} dragging={!!active} onEdit={() => setEditing(engine)} onDelete={() => setDeleting(engine)} />)}
          </SortableContext>
          {!displayed.length && <p className="search-engine-empty">添加一个搜索引擎即可开始搜索。</p>}
        </div>
      </DndContext>
    </>}
    <MacPresence open={!!editing && !hidden}>{editing && <EngineEditor engine={editing} onClose={() => setEditing(undefined)} onSave={engine => onChange({ ...preferences, desktopSearch: { ...config, engines: config.engines.some(item => item.id === engine.id) ? config.engines.map(item => item.id === engine.id ? engine : item) : [...config.engines, engine] } }, config.engines.some(item => item.id === engine.id) ? '搜索引擎已更新' : '搜索引擎已添加')} />}</MacPresence>
    <MacPresence open={!!deleting && !hidden}>{deleting && <MacAlertDialog title={`删除“${deleting.name}”？`} description="从桌面搜索的可选引擎中移除。" notifyErrors={false} onClose={() => setDeleting(undefined)} onConfirm={async () => { if (!await onChange({ ...preferences, desktopSearch: { ...config, engines: config.engines.filter(item => item.id !== deleting.id) } }, '搜索引擎已删除')) throw new Error('删除失败，请重试'); }} />}</MacPresence>
  </>;
}
