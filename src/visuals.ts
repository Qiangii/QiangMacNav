// Served by this deployment, including when external networks are unavailable.
const assets = '/assets';

export const APP_ICONS = {
  finder: `${assets}/finder-icon.png`,
  launchpad: `${assets}/launchpad-icon.png`,
  safari: `${assets}/safari-icon.png`,
  settings: `${assets}/settings-icon.png`,
  appstore: `${assets}/appstore-icon.png`,
  folder: `${assets}/projects-icon.png`,
} as const;

export const WALLPAPERS = {
  coast: { label: '山谷', image: `${assets}/wallpaper-mountain.png` },
  mountain: { label: '海岸', image: `${assets}/wallpaper-bigsur.png` },
  dusk: { label: '极光', image: `${assets}/wallpaper-aurora.png` },
  spring: { label: '春至', image: `${assets}/wallpapers/spring-poster.jpg`, video: `${assets}/wallpapers/spring.mp4` },
  coffee: { label: '咖啡', image: `${assets}/wallpapers/coffee.jpg` },
  cartoon: { label: '卡通', image: `${assets}/wallpapers/cartoon.jpg` },
  shinchan: { label: '蜡笔小新', image: `${assets}/wallpapers/shin-chan.jpg` },
  seaside: { label: '海边', image: `${assets}/wallpapers/seaside.jpg` },
  sunsetglow: { label: '霞光', image: `${assets}/wallpapers/sunset-glow.jpg` },
  snowmountain: { label: '雪山', image: `${assets}/wallpapers/snow-mountain.jpg` },
} as const;
