import { memo, useContext, type MouseEvent } from 'react';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { CategoryIcon } from './CategoryIcon';
import { SharedBadge } from './SharedBadge';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import type { Category, Site } from '../types';
import { SortableSite } from './SortableSite';
import { MacTooltip } from './ui';
import { NavigationDragContext } from './navigationDrag';

export type CategorySectionProps = {
  category: Category | null;
  sites: Site[];
  canEdit: boolean;
  showHeading?: boolean;
  sortingDisabled?: boolean;
  activeDrag?: string | null;
  onOpen: (site: Site) => void;
  onCategoryMenu: (event: MouseEvent, category: Category) => void;
  onSiteMenu: (event: MouseEvent, site: Site) => void;
};

export function CategorySection(props: CategorySectionProps) {
  const { category, canEdit, showHeading = true, sortingDisabled, activeDrag, onCategoryMenu } = props;
  const id = category?.id ?? 'none';
  const drag = useContext(NavigationDragContext);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useSortable({ id: `category:${id}`, disabled: !category || !canEdit || !showHeading || sortingDisabled });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop:${id}`, disabled: !canEdit || sortingDisabled });
  return <section data-sort-id={`category:${id}`} id={category ? `category-${category.id}` : undefined} className={`category-section ${isOver ? 'drop-active' : ''} ${activeDrag === `category:${id}` ? 'sort-placeholder' : ''}`} ref={category ? setNodeRef : undefined} onClickCapture={drag.guard} onContextMenuCapture={drag.guard} onContextMenu={category ? event => onCategoryMenu(event, category) : undefined}>
    <CategoryContents {...props} attributes={attributes} listeners={listeners} setDropRef={setDropRef} setActivatorNodeRef={setActivatorNodeRef} />
  </section>;
}

const CategoryContents = memo(function CategoryContents({ category, sites, canEdit, showHeading = true, sortingDisabled, activeDrag, onOpen, onCategoryMenu, onSiteMenu, attributes, listeners, setDropRef, setActivatorNodeRef }: CategorySectionProps & {
  attributes: ReturnType<typeof useSortable>['attributes']; listeners: ReturnType<typeof useSortable>['listeners'];
  setDropRef: ReturnType<typeof useDroppable>['setNodeRef']; setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef'];
}) {
  const drag = useContext(NavigationDragContext);
  const longPress = drag.mode === 'longPress' && !!category && canEdit;
  return <>
    {showHeading && <div className="category-heading">
      <div ref={longPress ? setActivatorNodeRef : undefined} {...(longPress ? attributes : {})} {...(longPress ? listeners : {})} aria-label={longPress ? `拖动 ${category.name} 分类` : undefined} className={`category-heading-title ${longPress ? 'long-press-target' : ''}`}>{category && canEdit && !longPress && <MacTooltip content="拖动分类排序"><button ref={setActivatorNodeRef} disabled={sortingDisabled} className="drag-handle" aria-label={`拖动 ${category.name} 分类`} {...attributes} {...listeners}><GripVertical size={17} /></button></MacTooltip>}
        <CategoryIcon className="category-mark" size={19} url={category?.iconUrl} />
        <h2>{category?.name ?? '未分类'}</h2>{category?.shared && <SharedBadge />}
      </div>
      {category && <MacTooltip content="分类操作"><button className="icon-button section-more" aria-label={`${category.name} 的操作`} aria-haspopup="menu" onClick={event => { event.stopPropagation(); onCategoryMenu(event, category); }}><MoreHorizontal size={18} /></button></MacTooltip>}
    </div>}
    <div ref={setDropRef} className="site-grid drop-zone">
      <SortableContext items={sites.map(site => `site:${site.id}`)} strategy={() => null}>
        {sites.map(site => <SortableSite key={site.id} site={site} sortingDisabled={sortingDisabled} placeholder={activeDrag === `site:${site.id}`} onOpen={onOpen} onMenu={onSiteMenu} canEdit={canEdit && site.editable} />)}
      </SortableContext>
      {sites.length === 0 && <span className="empty-category">此分类为空</span>}
    </div>
  </>;
});
