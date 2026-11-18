import { MacButton } from './MacButton';

export type MacSettingChoiceProps<T extends string> = {
  label: string;
  description?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
};

/** Shared settings row with a labelled segmented choice. */
export function MacSettingChoice<T extends string>({ label, description, value, options, onChange, disabled }: MacSettingChoiceProps<T>) {
  return <div className="setting-row"><div><strong>{label}</strong>{description && <span>{description}</span>}</div>
    <div className="segmented" role="group" aria-label={label}>{options.map(option => <MacButton key={option.value} aria-pressed={value === option.value} className={value === option.value ? 'selected' : ''} disabled={disabled} onClick={() => { if (option.value !== value) onChange(option.value); }}>{option.label}</MacButton>)}</div>
  </div>;
}
