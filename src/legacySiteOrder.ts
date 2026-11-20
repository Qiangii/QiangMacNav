import { api, message } from './api';
import type { CategorySiteOrder } from './types';

// v1.0.4 accepts one site and its destination index per write. Recheck all
// affected categories between writes so an outdated drag stops at the first conflict.
export async function saveLegacySiteOrder(groups: CategorySiteOrder[], sessionIsCurrent: () => boolean) {
  const pending = groups.map(({ categoryId, previousIds, ids }) => ({ categoryId, expected: [...previousIds], ids }));
  let savedMoves = 0;
  try {
    while (sessionIsCurrent()) {
      const snapshot = await api.navigation();
      if (!sessionIsCurrent()) return;
      for (const { categoryId, expected } of pending) {
        const sites = snapshot.sites.filter(s => s.editable && s.categoryId === categoryId);
        if (sites.length !== expected.length || sites.some((s, i) => s.id !== expected[i])) {
          throw new Error('分类中的站点或顺序已变更，请重新拖动');
        }
      }

      const group = pending.find(({ expected, ids }) => ids.some((id, i) => id !== expected[i]));
      if (!group) return snapshot;
      const { expected, ids, categoryId } = group;
      const first = ids.findIndex((id, i) => id !== expected[i]);
      let last = ids.length - 1;
      while (ids[last] === expected[last]) last--;
      // A normal drag in either direction needs just one write. Filtered
      // drags can require further moves to keep hidden sites in their slots.
      const index = expected[first] === ids[last] ? last : first;
      const siteId = ids[index];
      await api.reorder({ kind: 'sites', siteId, categoryId, index });
      savedMoves++;
      expected.splice(expected.indexOf(siteId), 1);
      expected.splice(index, 0, siteId);
    }
  } catch (error) {
    if (savedMoves) throw new Error(`已保存 ${savedMoves} 次站点移动，完整顺序尚未确认。${message(error)}`);
    throw error;
  }
}
