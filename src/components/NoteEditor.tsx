import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent, type PointerEvent } from 'react';
import { Baseline, Bold, Code, Heading2, Highlighter, ImagePlus, List, ListChecks, ListOrdered, Quote, Table2 } from 'lucide-react';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Paragraph from '@tiptap/extension-paragraph';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from '@tiptap/markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, message } from '../api';
import type { NoteDocument } from '../types';
import { MacAlertDialog, MacButton, MacFormDialog, MacInput, MacTextarea, useMacWindow } from './ui';
import { NoteTextStyle, noteTextStyleName, remarkNoteColors } from './noteTextStyle';
import './note-editor.css';

const imagePath = /^\/api\/notes\/[0-9a-f]{64}\/images\/[0-9a-f]{64}$/;
const imageWidth = (title: unknown) => typeof title === 'string' && /^width=[0-9]{2,4}$/.test(title)
  ? Math.max(32, Math.min(1600, Number(title.slice(6)))) : undefined;

const imageEdges = { n: '上', e: '右', s: '下', w: '左' } as const;
type ImageEdge = keyof typeof imageEdges;
type ImageResize = { pointerId: number; edge: ImageEdge; x: number; y: number; width: number; ratio: number };

function NoteImage({ node, updateAttributes, editor }: NodeViewProps) {
  const [previewWidth, setPreviewWidth] = useState<number>();
  const image = useRef<HTMLImageElement>(null);
  const gesture = useRef<ImageResize | null>(null);
  const { src, alt, title } = node.attrs;
  const width = imageWidth(title);

  function limit(value: number) {
    const block = image.current?.closest('p, h1, h2, h3, h4, h5, h6, td, th, .note-prose');
    let available = 1600;
    if (block) {
      const { paddingLeft, paddingRight } = getComputedStyle(block);
      available = block.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight);
    }
    return Math.max(32, Math.min(1600, available, Math.round(value)));
  }
  function start(event: PointerEvent<HTMLButtonElement>, edge: ImageEdge) {
    const rect = image.current?.getBoundingClientRect();
    if (!editor.isEditable || event.button !== 0 || !rect?.height || gesture.current) return;
    event.preventDefault();
    gesture.current = { pointerId: event.pointerId, edge, x: event.clientX, y: event.clientY, width: rect.width, ratio: rect.width / rect.height };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreviewWidth(rect.width);
  }
  function resize(event: PointerEvent<HTMLButtonElement>, finish = false) {
    const drag = gesture.current;
    if (drag?.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    const delta = { n: -dy * drag.ratio, s: dy * drag.ratio, w: -dx, e: dx }[drag.edge];
    const next = limit(drag.width + delta);
    if (finish) {
      cancel(event);
      if (editor.isEditable && next !== Math.round(drag.width)) updateAttributes({ title: `width=${next}` });
    } else {
      setPreviewWidth(next);
    }
  }
  function cancel(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPreviewWidth(undefined);
  }

  return <NodeViewWrapper as="span" className="note-image" contentEditable={false}>
    {imagePath.test(src) ? <span className="note-image-frame">
      <img ref={image} src={src} alt={alt ?? ''} width={previewWidth ?? width} draggable={false} />
      {(Object.keys(imageEdges) as ImageEdge[]).map(edge => <MacButton key={edge} className="note-image-edge" data-image-edge={edge}
        aria-label={`拖动图片${imageEdges[edge]}边调整尺寸`}
        onPointerDown={event => start(event, edge)}
        onPointerMove={event => resize(event)}
        onPointerUp={event => resize(event, true)}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={event => {
          const outward = { n: 'ArrowUp', e: 'ArrowRight', s: 'ArrowDown', w: 'ArrowLeft' }[edge];
          const inward = { n: 'ArrowDown', e: 'ArrowLeft', s: 'ArrowUp', w: 'ArrowRight' }[edge];
          if (!editor.isEditable || (event.key !== outward && event.key !== inward)) return;
          event.preventDefault();
          event.stopPropagation();
          const current = image.current?.getBoundingClientRect().width;
          if (current) updateAttributes({ title: `width=${limit(current + (event.key === outward ? 8 : -8))}` });
        }} />)}
    </span> : <span className="note-muted">请上传图片后插入便签</span>}
  </NodeViewWrapper>;
}

const noteExtensions = [
  StarterKit.configure({ underline: false, paragraph: false, link: { openOnClick: false } }),
  Paragraph.extend({
    parseMarkdown(token, helpers) {
      const tokens = token.tokens ?? [];
      // The default parser lifts lone images out of paragraphs for block images.
      // Keep older image-only paragraphs valid now that images are inline.
      if (tokens.length === 1 && tokens[0].type === 'image') {
        return helpers.createNode('paragraph', undefined, helpers.parseInline(tokens));
      }
      return this.parent?.(token, helpers) ?? [];
    },
  }),
  Image.extend({ addNodeView: () => ReactNodeViewRenderer(NoteImage) }).configure({ inline: true }),
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  NoteTextStyle,
  Markdown.configure({ markedOptions: { gfm: true } }),
];

type ImageInsert = (files: File[], insert: (src: string, width: number) => void) => void;

function RichNote({ content, disabled, onChange, upload }: {
  content: string; disabled: boolean; onChange: (value: string) => void; upload: ImageInsert;
}) {
  const editor = useEditor({
    extensions: noteExtensions,
    content,
    contentType: 'markdown',
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'note-prose', role: 'textbox', 'aria-label': '便签内容', 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
  });
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  const active = useEditorState({ editor, selector: ({ editor }) => ({
    bold: editor?.isActive('bold'), heading: editor?.isActive('heading', { level: 2 }),
    bulletList: editor?.isActive('bulletList'), orderedList: editor?.isActive('orderedList'), taskList: editor?.isActive('taskList'),
    blockquote: editor?.isActive('blockquote'), codeBlock: editor?.isActive('codeBlock'),
    color: editor?.getAttributes(noteTextStyleName).color as string | undefined,
    background: editor?.getAttributes(noteTextStyleName).background as string | undefined,
  }) });
  function insert(files: File[]) {
    if (!editor || disabled) return;
    upload(files, (src, width) => {
      if (!editor.isDestroyed) editor.chain().focus().setImage({ src, alt: '便签图片', title: `width=${width}` }).run();
    });
  }
  function paste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    insert(files);
  }
  if (!editor) return null;
  const controls = [
    { label: '粗体', icon: Bold, pressed: active?.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: '二级标题', icon: Heading2, pressed: active?.heading, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: '无序列表', icon: List, pressed: active?.bulletList, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '有序列表', icon: ListOrdered, pressed: active?.orderedList, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '待办清单', icon: ListChecks, pressed: active?.taskList, run: () => editor.chain().focus().toggleTaskList().run() },
    { label: '引用', icon: Quote, pressed: active?.blockquote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: '代码块', icon: Code, pressed: active?.codeBlock, run: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: '插入表格', icon: Table2, pressed: undefined, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ];
  return <>
    <div className="note-tools" role="group" aria-label="富文本格式">
      {controls.map(({ label, icon: Icon, pressed, run }) => <MacButton key={label} title={label} aria-label={label}
        aria-pressed={pressed} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={run}><Icon size={16} /></MacButton>)}
      <NoteColorTools color={active?.color} background={active?.background} disabled={disabled}
        onChange={(kind, value) => editor.chain().focus().setMark(noteTextStyleName, { [kind]: value }).run()} />
      <NoteImagePicker disabled={disabled} onFiles={insert} />
    </div>
    <div className="note-content mac-scroll-area" onPasteCapture={paste}><EditorContent className="note-rich-editor" editor={editor} /></div>
  </>;
}

const textColors = [
  ['红色', '#d7373f'], ['橙色', '#be5b00'], ['绿色', '#27834a'], ['蓝色', '#2469c8'], ['紫色', '#7d4abb'], ['灰色', '#69707d'],
];
const backgroundColors = [
  ['黄色', '#ffe29a'], ['橙色', '#ffd0a1'], ['粉色', '#ffc8d3'], ['绿色', '#b9ebc6'], ['蓝色', '#bfdbfe'], ['紫色', '#e3d1fa'],
];
type ColorKind = 'color' | 'background';

function NoteColorTools({ color, background, disabled, onChange }: {
  color?: string; background?: string; disabled: boolean; onChange: (kind: ColorKind, value: string | null) => void;
}) {
  const [open, setOpen] = useState<ColorKind>();
  const [custom, setCustom] = useState('#2469c8');
  const panelId = useId();
  const tools = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const isBackground = open === 'background';
  const colors = isBackground ? backgroundColors : textColors;
  const current = isBackground ? background : color;
  const label = isBackground ? '文字背景色' : '文字颜色';

  function apply(value: string | null) {
    if (!open || disabled) return;
    setOpen(undefined);
    onChange(open, value);
  }
  useEffect(() => {
    if (disabled) setOpen(undefined);
    if (!open) return;
    function dismiss(event: globalThis.PointerEvent) {
      if (!tools.current?.contains(event.target as Node)) setOpen(undefined);
    }
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open, disabled]);

  return <div ref={tools} className="note-color-tools" onKeyDown={event => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    setOpen(undefined); trigger.current?.focus();
  }}>
    {([
      ['color', '文字颜色', Baseline, color, '#2469c8'],
      ['background', '文字背景色', Highlighter, background, '#ffe29a'],
    ] as const).map(([kind, title, Icon, value, fallback]) => <MacButton key={kind} title={title} aria-label={title} disabled={disabled}
      aria-expanded={open === kind} aria-controls={open === kind ? panelId : undefined}
      onMouseDown={event => event.preventDefault()} onClick={event => {
        trigger.current = event.currentTarget;
        if (open === kind) { setOpen(undefined); return; }
        setCustom(value ?? fallback);
        setOpen(kind);
        event.currentTarget.focus();
      }}><Icon size={16} style={{ color: value }} /></MacButton>)}
    {open && <div id={panelId} className="note-color-panel" role="group" aria-label={`${label}选项`}>
      <div className="note-color-swatches">{colors.map(([name, value]) => <MacButton key={value} title={name} aria-label={name}
        aria-pressed={current === value} onClick={() => apply(value)} style={{ '--note-swatch': value } as React.CSSProperties} />)}</div>
      <div className="note-color-actions">
        <MacInput type="color" aria-label={`自定义${label}`} value={custom} onChange={event => setCustom(event.target.value)} />
        <MacButton onClick={() => apply(custom)}>应用</MacButton>
        <MacButton onClick={() => apply(null)}>{isBackground ? '清除背景' : '默认颜色'}</MacButton>
      </div>
    </div>}
  </div>;
}

function NoteImagePicker({ disabled, onFiles }: { disabled: boolean; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <MacButton title="上传图片" aria-label="上传图片" disabled={disabled} onClick={() => input.current?.click()}><ImagePlus size={16} /></MacButton>
    <MacInput ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={event => {
      onFiles(Array.from(event.target.files ?? []));
      event.target.value = '';
    }} />
  </>;
}

function MarkdownNote({ content, disabled, onChange, upload }: {
  content: string; disabled: boolean; onChange: (value: string) => void; upload: ImageInsert;
}) {
  const [preview, setPreview] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  function insert(files: File[]) {
    if (!files.length || disabled) return;
    const start = field.current?.selectionStart ?? content.length;
    const end = field.current?.selectionEnd ?? start;
    let before = content.slice(0, start);
    upload(files, (src, width) => {
      before += `![便签图片](${src} "width=${width}")`;
      onChange(before + content.slice(end));
    });
  }
  return <>
    <div className="note-tools" role="group" aria-label="Markdown 工具">
      <MacButton className="note-preview-toggle" aria-pressed={preview} disabled={disabled} onClick={() => setPreview(value => !value)}>预览</MacButton>
      <NoteImagePicker disabled={disabled || preview} onFiles={insert} />
    </div>
    {preview ? <div className="note-content note-prose mac-scroll-area" aria-label="Markdown 预览">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkNoteColors]} skipHtml components={{
        img: ({ src, alt, title }) => typeof src === 'string' && imagePath.test(src) ? <img className="note-preview-image" src={src} alt={alt ?? ''} width={imageWidth(title)} /> : null,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      }}>{content}</ReactMarkdown>
    </div> : <MacTextarea ref={field} className="note-content note-source mac-scroll-area" aria-label="Markdown 正文" value={content}
      placeholder="使用 Markdown 记录内容…" readOnly={disabled} onChange={event => onChange(event.target.value)} onPaste={event => {
        const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
        if (files.length) { event.preventDefault(); insert(files); }
      }} />}
  </>;
}

export default function NoteEditor({ initial, onTitle, onClose, onSaved }: {
  initial: NoteDocument; onTitle: (value: string) => void; onClose: () => void; onSaved: (note: NoteDocument) => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [mode, setMode] = useState<'rich' | 'markdown'>('rich');
  const [pending, setPending] = useState<'save' | 'upload'>();
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const dirty = title !== saved.title || content !== saved.content;
  const noteWindow = useMacWindow({
    fit: fitNoteWindow, minSize: { width: 280, height: 330 }, bottomInset: 12, allowCompact: true,
    onClose: close, onMinimize: close,
  });

  function close() {
    if (busy.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !dirty) return;
    busy.current = true;
    setPending('save'); setError(''); setDiscard(false);
    try {
      const next = await api.saveNote({ id: initial.id, title, content, version: saved.version });
      setSaved(next);
      setTitle(next.title);
      onSaved(next);
    } catch (reason) { setError(message(reason)); }
    finally { busy.current = false; setPending(undefined); }
  }

  const upload: ImageInsert = (files, insert) => {
    if (busy.current || !files.length) return;
    busy.current = true;
    setPending('upload'); setError(''); setDiscard(false);
    void (async () => {
      try {
        for (const file of files) {
          const image = await api.uploadNoteImage(initial.id, file);
          insert(image.url, Math.max(32, Math.min(480, image.width)));
        }
      } catch (reason) { setError(message(reason)); }
      finally { busy.current = false; setPending(undefined); }
    })();
  };

  return <><MacFormDialog title="便签" className="note-dialog" busy={!!pending} onClose={close} windowController={noteWindow}>
    <form ref={form} className={`note-form${keyboardFocus ? ' note-keyboard-focus' : ''}`} onSubmit={save}
      onPointerDownCapture={() => setKeyboardFocus(false)} onKeyDown={event => {
      if (event.key === 'Tab') setKeyboardFocus(true);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        form.current?.requestSubmit();
      }
    }}>
      <MacInput className="note-title" aria-label="便签标题" autoFocus value={title} readOnly={!!pending}
        placeholder="未命名便签" onChange={event => { setTitle(event.target.value); onTitle(event.target.value); }} />
      <div className="note-modes" role="group" aria-label="编辑格式">
        <MacButton aria-pressed={mode === 'rich'} disabled={!!pending} onClick={() => setMode('rich')}>富文本</MacButton>
        <MacButton aria-pressed={mode === 'markdown'} disabled={!!pending} onClick={() => setMode('markdown')}>Markdown</MacButton>
      </div>
      <div className="note-surface">
        {mode === 'rich' ? <RichNote content={content} disabled={!!pending} onChange={setContent} upload={upload} />
          : <MarkdownNote content={content} disabled={!!pending} onChange={setContent} upload={upload} />}
      </div>
      {error && <div className="mac-field-error" role="alert">{error}</div>}
      <div className="note-footer">
        <span role="status">{pending === 'upload' ? '正在上传图片…' : pending === 'save' ? '正在保存…' : dirty ? '有未保存的修改' : '已保存'}</span>
        <MacButton className="note-save" type="submit" disabled={!!pending || !dirty}>保存</MacButton>
      </div>
    </form>
  </MacFormDialog>
  {discard && <MacAlertDialog title="要保留这次修改吗？" description="放弃后，本次未保存的修改将丢失。"
    cancelLabel="继续编辑" confirmLabel="放弃修改" onClose={() => setDiscard(false)} onConfirm={async () => onClose()} />}
  </>;
}

function fitNoteWindow() {
  const width = Math.min(720, Math.max(0, window.innerWidth - 24));
  const height = Math.min(580, Math.max(0, window.innerHeight - 24));
  return { position: { x: (window.innerWidth - width) / 2, y: (window.innerHeight - height) / 2 }, size: { width, height } };
}
