import type { ComponentPropsWithRef } from 'react';

export type MacButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'plain' | 'primary' | 'secondary' | 'danger' | 'icon';
};

export function MacButton({ variant = 'plain', type = 'button', className = '', ...props }: MacButtonProps) {
  const style = variant === 'plain' ? '' : variant === 'icon' ? 'icon-button' : `${variant}-button`;
  return <button {...props} type={type} className={[style, className].filter(Boolean).join(' ')} />;
}
