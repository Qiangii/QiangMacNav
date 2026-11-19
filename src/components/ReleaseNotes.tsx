import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a: ({ href, title, children }) => href
    ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
    : <>{children}</>,
  img: ({ src, alt, title }) => src
    ? <img src={src} alt={alt ?? ''} title={title} loading="lazy" referrerPolicy="no-referrer" />
    : <>{alt}</>,
  table: ({ children }) => <div className="update-notes-table"><table>{children}</table></div>,
};

export default memo(function ReleaseNotes({ notes, releaseUrl }: { notes: string; releaseUrl: string }) {
  return <div className="update-notes">
    <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml urlTransform={(value, key) => {
      if (!value) return undefined;
      try {
        const url = new URL(value, releaseUrl);
        if (url.protocol === 'https:' || url.protocol === 'http:' || (key === 'href' && url.protocol === 'mailto:')) return url.href;
      } catch { /* Omit malformed URLs while keeping the note text. */ }
      return undefined;
    }}>{notes}</Markdown>
  </div>;
});
