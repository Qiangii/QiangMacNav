import type { ComponentPropsWithRef } from 'react';
import { MacInput } from './MacInput';

export type MacSwitchProps = Omit<ComponentPropsWithRef<'input'>, 'type'> & { wrapperClassName?: string };

export function MacSwitch({ wrapperClassName = '', ...props }: MacSwitchProps) {
  return <label className={`switch ${wrapperClassName}`.trim()}><MacInput {...props} type="checkbox" /><span aria-hidden="true" /></label>;
}
