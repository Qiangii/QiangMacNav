import { useContext, type MouseEvent } from 'react';
import { DndContext, closestCenter, type Modifier } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { CategoryIcon } from './CategoryIcon';
import { SharedBadge } from './SharedBadge';
import { MacButton, MacScrollArea, MacTooltip } from './ui';
import { NavigationDragContext, useNavigationSensors } from './navigationDrag';

export interface SidebarEntry { id: string; name: string; iconUrl?: string; shared: boolean }

// Applied by dnd-kit to pointer, touch and keyboard coordinates alike.
const restrictToVerticalParent: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => ({
  ...transform,
  x: 0,
  y: draggingNodeRect && containerNodeRect
    ? Math.max(containerNodeRect.top - draggingNodeRect.top, Math.min(transform.y, containerNodeRect.bottom - draggingNodeRect.bottom))
    : transform.y,
});
const sidebarModifiers = [restrictToVerticalParent];

function Row({ entry, selected, disabled, onSelect, onMenu }: {
  entry: SidebarEntry; selected: boolean; disabled: boolean;
  onSelect: (id: string) => void; onMenu: (event: MouseEvent, id: string) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: entry.id, disabled });
  const drag = useContext(NavigationDragContext);
  const longPress = drag.mode === 'longPress';
  return <div ref={setNodeRef} data-icon-motion={`category:${entry.id}`} className={`sidebar-category-row ${selected ? 'selected' : ''} ${isDragging ? 'sorting' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} onClickCapture={drag.guard} onContextMenuCapture={drag.guard} onContextMenu={event => onMenu(event, entry.id)}>
    <MacTooltip content={entry.name} disabled={isDragging}><MacButton ref={longPress ? setActivatorNodeRef : undefined} {...(longPress ? attributes : {})} {...(longPress ? listeners : {})} className={`finder-sidebar-item ${longPress ? 'long-press-target' : ''}`} aria-label={entry.name} aria-current={selected ? 'page' : undefined} onClick={() => onSelect(entry.id)}>
      <CategoryIcon url={entry.iconUrl} size={17} /><span>{entry.name}</span>{entry.shared && <SharedBadge />}
    </MacButton></MacTooltip>
    {!longPress && <MacTooltip content="拖动调整顺序" disabled={isDragging}><MacButton ref={setActivatorNodeRef} className="sidebar-category-grip" aria-label={`调整 ${entry.name} 顺序`} disabled={disabled} {...attributes} {...listeners}><GripVertical size={13} /></MacButton></MacTooltip>}
  </div>;
}

export function CategorySidebar({ entries, selected, onSelect, onMenu, onReorder }: {
  entries: SidebarEntry[]; selected: string;
  onSelect: (id: string) => void; onMenu: (event: MouseEvent, id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const drag = useContext(NavigationDragContext);
  const sensors = useNavigationSensors(drag.mode, 'sidebar');
  return <MacScrollArea role="navigation" cacheKey="sidebar" className="finder-sidebar-list unified-categories" aria-label="分类">
    <DndContext sensors={sensors} modifiers={sidebarModifiers} collisionDetection={closestCenter} onDragStart={drag.begin} onDragCancel={drag.end} onDragEnd={({ active, over }) => {
      drag.end();
      if (!over || active.id === over.id) return;
      const from = entries.findIndex(entry => entry.id === active.id);
      const to = entries.findIndex(entry => entry.id === over.id);
      if (from < 0 || to < 0) return;
      const next = arrayMove(entries, from, to);
      onReorder(next.map(entry => entry.id));
    }}>
      <SortableContext items={entries.map(entry => entry.id)} strategy={verticalListSortingStrategy}>
        {entries.map(entry => <Row key={entry.id} entry={entry} selected={selected === entry.id} disabled={false} onSelect={onSelect} onMenu={onMenu} />)}
      </SortableContext>
    </DndContext>
  </MacScrollArea>;
}
