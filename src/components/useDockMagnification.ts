import { useEffect, useRef } from 'react';

// One animation clock owns sizing; sortable transforms remain owned by dnd-kit.
export function useDockMagnification(layoutKey: string) {
  const dockRef = useRef<HTMLElement>(null);
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const icons = Array.from(dock.querySelectorAll<HTMLElement>('.dock-icon'));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = matchMedia('(min-width: 761px) and (hover: hover) and (pointer: fine)');
    let frame = 0;
    let lastTime = 0;
    let pointerX: number | null = null;
    let pressed = false;
    const sizes = icons.map(() => 1);
    let centers: number[] = [];
    let baseScroll = 0;
    const pinnedGroup = dock.querySelector<HTMLElement>('.pinned-group');
    const inPinnedGroup = icons.map(icon => pinnedGroup?.contains(icon) ?? false);

    const animate = (time: number) => {
      frame = 0;
      const dt = lastTime ? Math.min(40, time - lastTime) : 16.67;
      lastTime = time;
      const enabled = desktop.matches && !reduced.matches && !pressed;
      // ThanasOS uses resting icon centers, not the expanding visual centers.
      // Measuring the latter each frame feeds layout movement back into the curve.
      const scrollDelta = (pinnedGroup?.scrollLeft ?? 0) - baseScroll;
      const blend = 1 - Math.pow(1 - (pointerX === null ? .12 : .2), dt / (1000 / 60));
      let moving = false;
      icons.forEach((icon, index) => {
        const center = centers[index] - (inPinnedGroup[index] ? scrollDelta : 0);
        const distance = enabled && pointerX !== null ? Math.abs(pointerX - center) : Infinity;
        // A restrained 1.35x peak for our 52px icons, with a 240px cosine footprint.
        const target = distance < 120 ? 1 + .35 * (1 + Math.cos(Math.PI * distance / 120)) / 2 : 1;
        let next = sizes[index] + (target - sizes[index]) * blend;
        if (Math.abs(target - next) < .0005) next = target;
        else moving = true;
        if (sizes[index] !== next) icon.style.setProperty('--magnify', next.toFixed(5));
        sizes[index] = next;
      });
      if (moving) frame = requestAnimationFrame(animate);
      else lastTime = 0;
    };
    const start = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(animate); };
    const leave = () => { pointerX = null; start(); };
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      pointerX = null;
      pressed = false;
      sizes.fill(1);
      icons.forEach(icon => icon.style.removeProperty('--magnify'));
      centers = icons.map(icon => {
        const rect = icon.getBoundingClientRect();
        return rect.left + rect.width / 2;
      });
      baseScroll = pinnedGroup?.scrollLeft ?? 0;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || pressed || !desktop.matches || reduced.matches) return;
      pointerX = event.clientX;
      start();
    };
    // Freeze on press rather than shrinking under the pointer before click dispatch.
    const down = () => { pressed = true; cancelAnimationFrame(frame); frame = 0; lastTime = 0; };
    const up = () => { pressed = false; leave(); };
    const visibility = () => { if (document.hidden) reset(); };
    resetRef.current = reset;
    reset();
    dock.addEventListener('pointermove', move);
    dock.addEventListener('pointerleave', leave);
    dock.addEventListener('pointerdown', down, true);
    pinnedGroup?.addEventListener('scroll', start);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('resize', reset);
    reduced.addEventListener('change', reset);
    desktop.addEventListener('change', reset);
    return () => {
      reset();
      resetRef.current = () => {};
      dock.removeEventListener('pointermove', move);
      dock.removeEventListener('pointerleave', leave);
      dock.removeEventListener('pointerdown', down, true);
      pinnedGroup?.removeEventListener('scroll', start);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', reset);
      reduced.removeEventListener('change', reset);
      desktop.removeEventListener('change', reset);
    };
  }, [layoutKey]);

  return { dockRef, resetMagnification: () => resetRef.current() };
}
