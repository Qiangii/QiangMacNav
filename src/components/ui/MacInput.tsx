import type { ComponentPropsWithRef } from 'react';
import './form-controls.css';

export function MacInput(props: ComponentPropsWithRef<'input'>) {
  return <input {...props} />;
}

export function MacTextarea(props: ComponentPropsWithRef<'textarea'>) {
  return <textarea {...props} />;
}
