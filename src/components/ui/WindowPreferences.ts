import { createContext } from 'react';

export const TitlebarPositionContext = createContext<'left' | 'right'>('left');
export const DesktopThemeContext = createContext<'dark' | 'light' | undefined>(undefined);
