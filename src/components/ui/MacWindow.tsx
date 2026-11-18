import { useContext, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { TitlebarPositionContext } from './WindowPreferences';
import { TrafficLights, type TrafficLightsProps } from './TrafficLights';
import type { useMacWindow } from './useMacWindow';
import './windows.css';

export type MacWindowProps = ComponentPropsWithoutRef<'section'> & {
  controller: ReturnType<typeof useMacWindow>;
  titlebarClassName: string;
  titlebarContent: ReactNode;
  labels: TrafficLightsProps['labels'];
  resizeClassName?: string;
};

export function MacWindow({ controller, titlebarClassName, titlebarContent, labels, resizeClassName, className = '', children, style, ...props }: MacWindowProps) {
  const position = useContext(TitlebarPositionContext);
  return <section role="dialog" {...props} data-titlebar-position={position} className={[className, controller.maximized && 'maximized'].filter(Boolean).join(' ')} style={{ ...controller.style, ...style }}>
    <div className={titlebarClassName} onPointerDown={controller.startMove}>
      <TrafficLights maximized={controller.maximized} onClose={controller.close} onMinimize={controller.minimize} onToggleMaximize={controller.toggleMaximize} labels={labels} />
      {titlebarContent}
    </div>
    {children}
    {!controller.maximized && <div className={['mac-window-resize', resizeClassName].filter(Boolean).join(' ')} onPointerDown={controller.startResize} aria-hidden="true" />}
  </section>;
}
