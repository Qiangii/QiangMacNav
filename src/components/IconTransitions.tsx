import { Component, createRef } from 'react';
import type { NavigationData } from '../types';
import { DEFAULT_DOCK_TOOLS } from './dockTools';
import './icon-transitions.css';

function iconKeys(data: NavigationData) {
  return new Set([
    ...data.sites.map(site => `site:${site.id}`),
    ...data.categories.map(category => `category:${category.id}`),
    ...(data.desktopItems ?? []).map(item => `desktop:${item.kind}:${item.id}`),
    ...data.dockItems.map(item => `dock:${item.kind}:${item.id}`),
    ...(data.preferences.dockTools ?? DEFAULT_DOCK_TOOLS).map(tool => `dock:tool:${tool}`),
  ]);
}

function visibleIcon(target: HTMLElement) {
  if (target.closest('[inert], [hidden]')) return;
  const slot = target.querySelector('.site-icon, .category-image, .desktop-shortcut-image') ?? target;
  const art = slot.querySelector('img, svg, video') ?? slot;
  const rect = art.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  if (!rect.width || !rect.height || x < 0 || x > innerWidth || y < 0 || y > innerHeight) return;
  for (let parent = art.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden') return;
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const bounds = parent.getBoundingClientRect();
    if (style.overflowX !== 'visible' && (x < bounds.left || x > bounds.right)) return;
    if (style.overflowY !== 'visible' && (y < bounds.top || y > bounds.bottom)) return;
  }
  const style = getComputedStyle(art);
  let url = '';
  if (art instanceof HTMLImageElement) url = art.currentSrc || art.src;
  if (art instanceof SVGSVGElement) {
    const svg = art.cloneNode(true) as SVGSVGElement;
    svg.setAttribute('color', style.color);
    url = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  }
  const surface = target.closest('[data-desktop-window], .desktop-shortcuts, .dock-wrap, .launchpad-overlay');
  return { target, rect, url, color: url ? style.backgroundColor : style.color, radius: style.borderRadius,
    zIndex: surface ? getComputedStyle(surface).zIndex : 'auto' };
}

type Icon = NonNullable<ReturnType<typeof visibleIcon>>;
type Change = { removed: Icon[]; added: Set<string> };
type Props = { data: NavigationData };

// Read outgoing geometry before React removes or reflows the rows. Incoming
// geometry is measured after commit, including the new centered Dock position.
export class IconTransitions extends Component<Props> {
  private host = createRef<HTMLDivElement>();
  private cleanups = new Set<() => void>();
  private motion = matchMedia('(prefers-reduced-motion: reduce)');

  private clear = () => { for (const cleanup of this.cleanups) cleanup(); };
  componentDidMount() {
    this.motion.addEventListener('change', this.clear);
    window.addEventListener('resize', this.clear);
  }
  componentWillUnmount() {
    this.motion.removeEventListener('change', this.clear);
    window.removeEventListener('resize', this.clear);
    this.clear();
  }
  private find(keys: Set<string>) {
    const icons: Icon[] = [];
    if (!keys.size) return icons;
    for (const target of this.host.current?.parentElement?.querySelectorAll<HTMLElement>('[data-icon-motion]') ?? []) {
      if (!keys.has(target.dataset.iconMotion!)) continue;
      const icon = visibleIcon(target);
      if (icon) icons.push(icon);
    }
    return icons;
  }
  getSnapshotBeforeUpdate(previous: Props): Change | null {
    if (previous.data === this.props.data || this.motion.matches || document.hidden) return null;
    const before = iconKeys(previous.data), after = iconKeys(this.props.data);
    const removed = new Set([...before].filter(key => !after.has(key)));
    const added = new Set([...after].filter(key => !before.has(key) && /^(desktop|dock):/.test(key)));
    return { removed: this.find(removed), added };
  }
  componentDidUpdate(_previous: Props, _state: unknown, change: Change | null) {
    if (!change) return;
    for (const icon of change.removed) this.play(icon, false);
    for (const icon of this.find(change.added)) this.play(icon, true);
  }
  private play(icon: Icon, entering: boolean) {
    const { rect } = icon;
    const layer = document.createElement('div');
    layer.className = `icon-particles ${entering ? 'assembling' : 'scattering'}`;
    Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: icon.zIndex });
    if (icon.url) layer.style.setProperty('--particle-image', `url(${JSON.stringify(icon.url)})`);
    layer.style.setProperty('--particle-color', icon.color);
    layer.style.setProperty('--particle-radius', icon.radius);

    // Shared vertices tile the original artwork without gaps. Each small shard
    // fans out from its own center, keeping the icon recognizable at both ends.
    const cells = rect.width < 28 ? 3 : 4;
    const edge = (x: number, y: number) => {
      const jitter = (seed: number) => Math.sin(seed * 17.3) * 0.18;
      return `${(x + (x > 0 && x < cells ? jitter(x + 3*y) : 0)) * 100 / cells}% ${(y + (y > 0 && y < cells ? jitter(y + 5*x) : 0)) * 100 / cells}%`;
    };
    for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
      const shard = document.createElement('i');
      const dx = (x + 0.5) / cells - 0.5, dy = (y + 0.5) / cells - 0.5;
      const reach = Math.max(24, rect.width) * (0.85 + Math.random() * 0.65);
      shard.style.clipPath = `polygon(${edge(x,y)},${edge(x+1,y)},${edge(x+1,y+1)},${edge(x,y+1)})`;
      shard.style.transformOrigin = `${(dx+0.5)*100}% ${(dy+0.5)*100}%`;
      shard.style.setProperty('--dx', `${dx * reach}px`);
      shard.style.setProperty('--dy', `${dy * reach - 5}px`);
      shard.style.setProperty('--twist', `${(Math.random() - 0.5) * 125}deg`);
      shard.style.animationDelay = `${Math.random() * 55}ms`;
      layer.append(shard);
    }
    this.host.current!.append(layer);
    const reveal = entering ? icon.target.animate([
      { opacity: 0, scale: '.84' }, { opacity: 0, scale: '.92', offset: .40 },
      { opacity: 1, scale: '1.035', offset: .82 }, { opacity: 1, scale: '1' },
    ], { duration: 460, easing: 'ease-out' }) : undefined;
    const cleanup = () => { clearTimeout(timer); reveal?.cancel(); layer.remove(); this.cleanups.delete(cleanup); };
    const timer = window.setTimeout(cleanup, 540);
    this.cleanups.add(cleanup);
  }
  render() { return <div className="icon-motion-host" ref={this.host} aria-hidden="true" />; }
}
