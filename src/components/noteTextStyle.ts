import { Mark } from '@tiptap/core';
import type { Parent, PhrasingContent, Root } from 'mdast';

type NoteColors = { color: string | null; background: string | null };
export const noteTextStyleName = 'noteTextStyle';
const hexColor = /^#[0-9a-f]{6}$/i;
const openingTag = /^<span data-note-style="(#[0-9a-f]{6}|-)\/(#[0-9a-f]{6}|-)">/i;
const closingTag = '</span>';

function readColors(value: string) {
  const match = openingTag.exec(value);
  if (!match) return;
  const colors = { color: match[1] === '-' ? null : match[1], background: match[2] === '-' ? null : match[2] };
  if (colors.color || colors.background) return { colors, raw: match[0] };
}

function encodeColors(color: unknown, background: unknown) {
  const foreground = typeof color === 'string' && hexColor.test(color) ? color : '-';
  const fill = typeof background === 'string' && hexColor.test(background) ? background : '-';
  return foreground === '-' && fill === '-' ? null : `${foreground}/${fill}`;
}

function colorCSS({ color, background }: NoteColors) {
  return [color && `color:${color}`, background && `background-color:${background}`].filter(Boolean).join(';');
}

export const NoteTextStyle = Mark.create({
  name: noteTextStyleName,
  // Keep the color wrapper outside emphasis so its opening angle bracket
  // never prevents Markdown's delimiters from opening inside a word.
  priority: 110,
  addAttributes: () => ({ color: { default: null, rendered: false }, background: { default: null, rendered: false } }),
  parseHTML: () => [{
    tag: 'span[data-note-style]',
    getAttrs: node => readColors(`<span data-note-style="${node.getAttribute('data-note-style')}">`)?.colors ?? false,
  }],
  renderHTML: ({ mark }) => {
    const encoded = encodeColors(mark.attrs.color, mark.attrs.background);
    const parsed = readColors(`<span data-note-style="${encoded}">`);
    return parsed ? ['span', { 'data-note-style': encoded, style: colorCSS(parsed.colors) }, 0] : ['span', {}, 0];
  },
  markdownTokenizer: {
    name: noteTextStyleName,
    level: 'inline',
    start: '<span data-note-style="',
    tokenize(source, _tokens, lexer) {
      const style = readColors(source);
      if (!style) return;
      const end = source.indexOf(closingTag, style.raw.length);
      if (end < 0) return;
      return {
        type: noteTextStyleName, raw: source.slice(0, end + closingTag.length), colors: style.colors,
        tokens: lexer.inlineTokens(source.slice(style.raw.length, end)),
      };
    },
  },
  parseMarkdown: (token, helpers) => helpers.applyMark(noteTextStyleName, helpers.parseInline(token.tokens ?? []), token.colors),
  renderMarkdown: (node, helpers) => {
    const content = helpers.renderChildren(node);
    const encoded = encodeColors(node.attrs?.color, node.attrs?.background);
    return encoded ? `<span data-note-style="${encoded}">${content}</span>` : content;
  },
});

// Keep arbitrary HTML disabled in the preview. Only known color spans become
// elements, and their CSS is constructed from validated hexadecimal values.
export function remarkNoteColors() {
  function visit(parent: Parent) {
    if (['paragraph', 'heading', 'tableCell', 'strong', 'emphasis', 'delete', 'link'].includes(parent.type)) {
      const children = parent.children as PhrasingContent[];
      for (let i = 0; i < children.length; i++) {
        const opening = children[i];
        if (opening.type !== 'html') continue;
        const style = readColors(opening.value);
        if (!style || style.raw !== opening.value) continue;
        const end = children.findIndex((child, index) => index > i && child.type === 'html' && child.value === closingTag);
        if (end < 0) continue;
        children.splice(i, end - i + 1, {
          type: 'emphasis',
          children: children.slice(i + 1, end),
          data: { hName: 'span', hProperties: { style: colorCSS(style.colors) } },
        });
      }
    }
    for (const child of parent.children) if ('children' in child) visit(child);
  }
  return (root: Root) => visit(root);
}
