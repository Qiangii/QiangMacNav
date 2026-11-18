// executeScript serializes this function: keep all dependencies inside it.
export function readPageMetadata() {
  const trim = (value: string, length: number) => [...value.trim()].slice(0, length).join('');
  const resolve = (value: string | null) => {
    try {
      if (!value) return '';
      const url = new URL(value, document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048 ? url.href : '';
    } catch { return ''; }
  };
  const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content || '';
  const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel]')];
  const icon = icons.find(item => item.rel.toLowerCase().split(/\s+/).includes('icon') && resolve(item.getAttribute('href')))
    || icons.find(item => item.rel.toLowerCase().includes('apple-touch-icon') && resolve(item.getAttribute('href')));
  return {
    name: trim(document.title || meta('meta[property="og:title"]') || location.hostname, 100),
    url: resolve(location.href),
    logoUrl: icon ? resolve(icon.getAttribute('href')) : '',
    note: trim(meta('meta[name="description" i]') || meta('meta[property="og:description"]'), 500),
  };
}
