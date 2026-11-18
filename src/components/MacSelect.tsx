import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown } from 'lucide-react';
import { MacButton } from './ui/MacButton';
import { MacScrollArea } from './ui/MacScrollArea';
import './mac-select.css';

export type MacSelectOption = { value: string; label: string; icon?: ReactNode; disabled?: boolean };
export type MacSelectProps = {
  label: string; value: string; options: MacSelectOption[]; onChange: (value: string) => void;
  compact?: boolean; disabled?: boolean; showCheck?: boolean; alignIcons?: boolean;
};

export function MacSelect({ label, value, options, onChange, compact = false, disabled = false, showCheck = true, alignIcons = false }: MacSelectProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [geometry, setGeometry] = useState({ left: 0, top: 0, width: 0, height: 240, above: false });
  const [light, setLight] = useState(false);
  const typeahead = useRef({ text: '', at: 0 });
  const selected = options.findIndex(option => option.value === value);

  function show() { setActive(selected >= 0 && !options[selected].disabled ? selected : options.findIndex(option => !option.disabled)); setOpen(true); }
  function choose(index: number) {
    if (!options[index] || options[index].disabled) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const desired = Math.min(242, options.length * 29 + 12);
    const flip = below < desired && above > below;
    const height = Math.max(29, Math.min(desired, flip ? above : below));
    const width = Math.min(compact ? Math.max(160, rect.width) : rect.width, window.innerWidth - 16);
    const triggerIcon = trigger.current.querySelector<HTMLElement>('.mac-select-option-icon');
    const optionIcon = popup.current?.querySelector<HTMLElement>('.mac-select-option-icon');
    // offsetLeft avoids the popup's entrance transform skewing the alignment.
    const left = alignIcons && triggerIcon && optionIcon && popup.current ? triggerIcon.getBoundingClientRect().left - optionIcon.offsetLeft - popup.current.clientLeft : rect.left;
    setGeometry({ left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), top: flip ? rect.top - height - 5 : rect.bottom + 5, width, height, above: flip });
    setLight(!!trigger.current.closest('.theme-light'));
  }, [open, options.length, compact, alignIcons, selected, showCheck]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    // A long URL field can scroll horizontally on blur. Only an ancestor
    // scrolling actually moves the trigger relative to the fixed menu.
    const scroll = (event: Event) => {
      if (event.target === window || (event.target instanceof Node && event.target.contains(trigger.current))) setOpen(false);
    };
    const resize = () => setOpen(false);
    // Capture outside presses even when a desktop widget stops propagation.
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize); };
  }, [open]);

  useEffect(() => {
    if (open) popup.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function keydown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (open) choose(active); else show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { show(); return; }
      const step = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
      const start = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : active + step;
      for (let index = start; index >= 0 && index < options.length; index += step) {
        if (!options[index].disabled) { setActive(index); break; }
      }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const text = (Date.now() - typeahead.current.at < 700 ? typeahead.current.text : '') + event.key.toLocaleLowerCase();
      typeahead.current = { text, at: Date.now() };
      const found = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(text));
      setOpen(true);
      if (found >= 0) setActive(found);
    }
  }

  return <div className={`mac-select-field${compact ? ' mac-select-compact' : ''}`}>
    <label id={`${id}-label`} htmlFor={`${id}-trigger`}>{label}</label>
    <MacButton ref={trigger} disabled={disabled} id={`${id}-trigger`} type="button" role="combobox" aria-labelledby={`${id}-label`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined} className={`mac-select-trigger ${open ? 'expanded' : ''}`} onKeyDown={keydown} onClick={() => open ? setOpen(false) : show()}>
      {options[selected]?.icon && <span className="mac-select-option-icon">{options[selected].icon}</span>}<span className="mac-select-value">{options[selected]?.label ?? '请选择'}</span><ChevronsUpDown size={15} />
    </MacButton>
    {open && createPortal(<MacScrollArea ref={popup} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className={`mac-select-popup ${light ? 'is-light' : ''} ${geometry.above ? 'is-above' : ''}`} style={{ left: geometry.left, top: geometry.top, width: geometry.width, maxHeight: geometry.height }} onPointerDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} data-index={index} role="option" aria-disabled={option.disabled || undefined} aria-selected={option.value === value} className={`mac-select-option ${active === index && !option.disabled ? 'active' : ''}`} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
        {showCheck && <span className="mac-select-check">{option.value === value && <Check size={14} />}</span>}{option.icon && <span className="mac-select-option-icon">{option.icon}</span>}<span title={option.label}>{option.label}</span>
      </div>)}
    </MacScrollArea>, document.body)}
  </div>;
}
