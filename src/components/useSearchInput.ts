import { useRef, useState, type ComponentPropsWithoutRef } from 'react';

/** Keep IME preedit text local; only confirmed text updates search and its cache. */
export function useSearchInput(query: string, onCommit: (value: string) => void) {
  const composing = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);

  function setQuery(value: string) {
    composing.current = false;
    setDraft(null);
    if (value !== query) onCommit(value);
  }

  const inputProps = {
    value: draft ?? query,
    onChange: event => {
      if (composing.current || (event.nativeEvent as InputEvent).isComposing) {
        composing.current = true;
        setDraft(event.currentTarget.value);
      } else setQuery(event.currentTarget.value);
    },
    onCompositionStart: event => {
      composing.current = true;
      setDraft(event.currentTarget.value);
    },
    onCompositionEnd: event => {
      if (composing.current) setQuery(event.currentTarget.value);
    },
    onBlur: () => {
      composing.current = false;
      setDraft(null);
    },
  } satisfies ComponentPropsWithoutRef<'input'>;

  return { inputProps, setQuery, composing };
}
