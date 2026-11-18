import { GripVertical, MoreHorizontal } from 'lucide-react';
import { CategoryIcon } from './CategoryIcon';
import type { Category, Site } from '../types';
import { SiteIcon } from './SiteIcon';

// Presentation only: overlays must never register a second sortable ID.
export function SiteCard({ site }: { site: Site }) {
  return <div className="site-item"><button tabIndex={-1} className="site-grip"><GripVertical size={16} /></button><button tabIndex={-1} className="site-open"><SiteIcon site={site} /><span className="site-copy"><strong>{site.name}</strong><small>{site.note || site.url}</small></span></button><button tabIndex={-1} className="site-more"><MoreHorizontal size={17} /></button></div>;
}

export function CategoryPreview({ category, sites, columns }: { category: Category; sites: Site[]; columns?: string }) {
  return <section className="category-section category-preview"><div className="category-heading"><div className="category-heading-title"><button tabIndex={-1} className="drag-handle"><GripVertical size={17} /></button><CategoryIcon className="category-mark" size={19} url={category.iconUrl} /><h2>{category.name}</h2></div><button tabIndex={-1} className="icon-button section-more"><MoreHorizontal size={18} /></button></div><div className="site-grid drop-zone" style={{ gridTemplateColumns: columns }}>{sites.map(site => <SiteCard key={site.id} site={site} />)}{!sites.length && <span className="empty-category">此分类为空</span>}</div></section>;
}
