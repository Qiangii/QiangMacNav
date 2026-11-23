import { useContext, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { TitlebarPositionContext } from './WindowPreferences';
import { TrafficLights, type TrafficLightsProps } from './TrafficLights';
import type { useMacWindow } from './useMacWindow';
import { WINDOW_RESIZE_DIRECTIONS } from './windowGeometry';
import './windows.css';

export type MacWindowProps = ComponentPropsWithoutRef<'section'> & {
  controller: ReturnType<typeof useMacWindow>;
  titlebarClassName: string;
  titlebarContent: ReactNode;
  labels: TrafficLightsProps['labels'];
};

export function MacWindowResizeHandles({ controller }: { controller: MacWindowProps['controller'] }) {
  if (controller.maximized) return null;
  return WINDOW_RESIZE_DIRECTIONS.map(direction => <div key={direction} className="mac-window-resize" data-resize-direction={direction} data-compact-resize={controller.allowCompact || undefined}
    onPointerDown={event => controller.startResize(event, direction)} aria-hidden="true" />);
}

export function MacWindow({ controller, titlebarClassName, titlebarContent, labels, className = '', children, style, ...props }: MacWindowProps) {
  const position = useContext(TitlebarPositionContext);
  return <section role="dialog" {...props} data-titlebar-position={position} className={[className, controller.maximized && 'maximized'].filter(Boolean).join(' ')} style={{ ...controller.style, ...style }}>
    <div className={titlebarClassName} onPointerDown={controller.startMove}>
      <TrafficLights maximized={controller.maximized} onClose={controller.close} onMinimize={controller.minimize} onToggleMaximize={controller.toggleMaximize} labels={labels} />
      {titlebarContent}
    </div>
    {children}
    <MacWindowResizeHandles controller={controller} />
  </section>;
}
