import type { KeyboardEvent, MouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { openSite } from '../api';
import type { Category, Site } from '../types';
import { CategoryIcon } from './CategoryIcon';
import { SiteIcon } from './SiteIcon';
import { MacButton, MacTooltip } from './ui';

export type LaunchpadEntry = { key: string } & ({ kind: 'site'; item: Site } | { kind: 'category'; item: Category });

export function LaunchpadArtwork({ entry }: { entry: LaunchpadEntry }) {
  return <>{entry.kind === 'site' ? <SiteIcon site={entry.item} /> : <span className="launchpad-folder"><CategoryIcon size={38} url={entry.item.iconUrl} /></span>}<span>{entry.item.name}</span></>;
}

export function LaunchpadIcon({ entry, index, sortable, sorting, blocked, onCategory, onClose, onSiteMenu }: {
  entry: LaunchpadEntry; index: number; sortable: boolean; sorting: boolean; blocked: () => boolean;
  onCategory: (item: Category) => void; onClose: () => void;
  onSiteMenu: (event: MouseEvent | KeyboardEvent, site: Site) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging, isOver } = useSortable({ id: entry.key, disabled: { draggable: !sortable, droppable: !sortable } });
  return <div ref={setNodeRef} className="launchpad-cell" data-launchpad-key={entry.key} data-sort-locked={!sortable || undefined} data-over={isOver || undefined}>
    <div className="launchpad-cell-motion" style={{ transform: sorting && sortable ? CSS.Transform.toString(transform) : undefined, transition: sorting ? transition : undefined, opacity: isDragging ? 0 : undefined }}>
      <MacTooltip disabled={sorting} content={entry.kind === 'site' ? entry.item.note.trim() || entry.item.name : entry.item.name}>
        <MacButton ref={setActivatorNodeRef} {...(sortable ? attributes : {})} {...listeners} className="launchpad-item" data-icon-motion={entry.kind === 'site' ? entry.key : undefined}
          style={{ animationDelay: `${Math.min(index, 8) * 22}ms` }} onDragStart={event => event.preventDefault()}
          onClick={() => {
            if (blocked()) return;
            if (entry.kind === 'category') onCategory(entry.item);
            else { openSite(entry.item); onClose(); }
          }} onContextMenu={event => {
            if (blocked()) { event.preventDefault(); return; }
            if (entry.kind === 'site') { event.currentTarget.focus({ preventScroll: true }); onSiteMenu(event, entry.item); }
          }} onKeyDown={event => {
            if (!sorting && entry.kind === 'site' && (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) onSiteMenu(event, entry.item);
            else listeners?.onKeyDown?.(event);
          }}><LaunchpadArtwork entry={entry} /></MacButton>
      </MacTooltip>
    </div>
  </div>;
}
