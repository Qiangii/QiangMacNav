import { Users } from 'lucide-react';
import './shared-badge.css';

export function SharedBadge() {
  return <span className="category-shared-badge" title="全站用户可见" aria-label="共享分类"><Users size={11} aria-hidden="true" /><span>共享</span></span>;
}
