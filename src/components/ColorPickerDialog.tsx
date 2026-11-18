import { useState } from 'react';
import { MacButton, MacFormDialog, MacInput } from './ui';

function toHSV(hex: string) {
  const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: hue * 60, s: max ? delta / max * 100 : 0, v: max * 100 };
}

function toHex({ h, s, v }: ReturnType<typeof toHSV>) {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * v / 100 * (1 - s / 100 * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

export function ColorPickerDialog({ value, onConfirm, onClose }: {
  value: string; onConfirm: (color: string) => Promise<boolean>; onClose: () => void;
}) {
  const [hsv, setHSV] = useState(() => toHSV(value));
  const [hex, setHex] = useState(value);
  const [busy, setBusy] = useState(false);
  const valid = /^#[0-9a-f]{6}$/i.test(hex);
  const color = toHex(hsv);
  function change(next: typeof hsv) { setHSV(next); setHex(toHex(next)); }
  function point(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    change({ ...hsv, s: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), v: Math.max(0, Math.min(100, (1 - (event.clientY - rect.top) / rect.height) * 100)) });
  }
  return <MacFormDialog title="选择填充颜色" className="icon-color-picker" busy={busy} onClose={onClose}>
    <form onSubmit={async event => {
      event.preventDefault(); if (!valid || busy) return;
      setBusy(true);
      try { if (await onConfirm(hex.toLowerCase())) onClose(); }
      catch { /* The preference save owns error feedback. */ }
      finally { setBusy(false); }
    }}>
      <div className="icon-color-plane" role="group" aria-label="颜色区域" style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
        onPointerDown={event => { if (busy || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); point(event); }}
        onPointerMove={event => { if (!busy && event.currentTarget.hasPointerCapture(event.pointerId)) point(event); }}>
        <span style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: color }} />
      </div>
      <label className="icon-color-slider">色相<MacInput type="range" min="0" max="360" step="1" value={hsv.h} disabled={busy} onChange={event => change({ ...hsv, h: Number(event.target.value) })} /></label>
      <div className="icon-color-numbers">
        <label>饱和度<MacInput type="number" min="0" max="100" value={Math.round(hsv.s)} disabled={busy} onChange={event => change({ ...hsv, s: Math.max(0, Math.min(100, Number(event.target.value))) })} /></label>
        <label>亮度<MacInput type="number" min="0" max="100" value={Math.round(hsv.v)} disabled={busy} onChange={event => change({ ...hsv, v: Math.max(0, Math.min(100, Number(event.target.value))) })} /></label>
      </div>
      <div className="icon-color-hex"><span className="icon-color-preview" style={{ background: color }} aria-hidden="true" /><label>颜色值<MacInput value={hex.toUpperCase()} maxLength={7} spellCheck={false} aria-invalid={!valid} disabled={busy} onChange={event => { const next = event.target.value; setHex(next); if (/^#[0-9a-f]{6}$/i.test(next)) setHSV(toHSV(next)); }} /></label></div>
      <div className="dialog-actions"><MacButton variant="secondary" disabled={busy} onClick={onClose}>取消</MacButton><MacButton type="submit" variant="primary" disabled={busy || !valid}>{busy ? '正在保存…' : '确定'}</MacButton></div>
    </form>
  </MacFormDialog>;
}
