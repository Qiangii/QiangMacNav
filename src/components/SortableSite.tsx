import { memo, useContext, type MouseEvent } from 'react';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import type { Site } from '../types';
import { SiteIcon } from './SiteIcon';
import { MacTooltip } from './ui';
import { NavigationDragContext } from './navigationDrag';

export type SortableSiteProps = {
  site: Site;
  onOpen: (site: Site) => void;
  onMenu: (event: MouseEvent, site: Site) => void;
  canEdit: boolean;
  sortingDisabled?: boolean;
  placeholder?: boolean;
};

export function SiteItem(props: Pick<SortableSiteProps, 'site' | 'onOpen' | 'onMenu'>) {
  return <div className="site-item" data-site-id={props.site.id} role="listitem" onContextMenu={event => props.onMenu(event, props.site)}>
    <SiteControls {...props} canEdit={false} />
  </div>;
}

export function SortableSite(props: SortableSiteProps) {
  const { site, canEdit, sortingDisabled, placeholder, onMenu } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useSortable({ id: `site:${site.id}`, disabled: !canEdit || sortingDisabled });
  const drag = useContext(NavigationDragContext);
  return <div ref={setNodeRef} data-sort-id={`site:${site.id}`} className={`site-item ${placeholder ? 'sort-placeholder' : ''}`} onClickCapture={drag.guard} onContextMenuCapture={drag.guard} onContextMenu={event => onMenu(event, site)}>
    <SiteControls {...props} attributes={attributes} listeners={listeners} activatorRef={setActivatorNodeRef} />
  </div>;
}

// dnd-kit publishes pointer coordinates to every sortable. Keep the icon, tooltip
// and text subtree memoized so it doesn't rerender for every pointer movement.
const SiteControls = memo(function SiteControls({ site, onOpen, onMenu, canEdit, sortingDisabled, attributes, listeners, activatorRef }: SortableSiteProps & {
  attributes?: ReturnType<typeof useSortable>['attributes']; listeners?: ReturnType<typeof useSortable>['listeners']; activatorRef?: ReturnType<typeof useSortable>['setActivatorNodeRef'];
}) {
  const { mode } = useContext(NavigationDragContext);
  const longPress = mode === 'longPress' && canEdit;
  return <>
    {canEdit && !longPress && <MacTooltip content="拖动网站排序"><button ref={activatorRef} disabled={sortingDisabled} className="site-grip" aria-label={`拖动 ${site.name} 网站`} {...attributes} {...listeners}><GripVertical size={16} /></button></MacTooltip>}
    <MacTooltip content={site.note} disabled={!site.note.trim()}><button ref={longPress ? activatorRef : undefined} {...(longPress ? attributes : {})} {...(longPress ? listeners : {})} className={`site-open ${longPress ? 'long-press-target' : ''}`} onClick={() => onOpen(site)} aria-label={`打开 ${site.name}`}>
      <SiteIcon site={site} />
      <span className="site-copy"><strong>{site.name}</strong><small>{site.note || site.url}</small></span>
    </button></MacTooltip>
    <MacTooltip content="更多操作"><button className="site-more" aria-label={`${site.name} 的操作`} aria-haspopup="menu" onClick={event => { event.stopPropagation(); onMenu(event, site); }}><MoreHorizontal size={17} /></button></MacTooltip>
  </>;
});
