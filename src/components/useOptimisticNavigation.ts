import { useState } from 'react';
import { api } from '../api';
import { OptimisticQueue } from '../optimisticQueue';
import type { NavigationData } from '../types';

export function useOptimisticNavigation() {
  const [data, publish] = useState<NavigationData | null>(null);
  const [saving, pending] = useState(false);
  const [queue] = useState(() => new OptimisticQueue<NavigationData>(publish, pending, () => api.navigation()));
  return { data, setData: queue.set, saving, queue };
}
