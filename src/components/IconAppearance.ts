import { createContext } from 'react';

export const DEFAULT_ICON_BACKGROUND = '#f7f8fa';
export const IconAppearanceContext = createContext({
  iconBackgroundEnabled: true,
  iconBackgroundColor: DEFAULT_ICON_BACKGROUND,
});
