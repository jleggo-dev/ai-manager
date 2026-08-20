import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Keep the reader where they were when older content lands above them.
 *
 * A scroll container measures from the TOP, so inserting an hour of conversation above the
 * viewport leaves `scrollTop` untouched and the content underneath it moves down — the paragraph
 * someone was reading vanishes upward, replaced by the middle of a conversation from last week.
 * The correction is exact rather than approximate: note the height before the insert, and after it
 * add however much the content grew.
 *
 * Declared AFTER `useStickToBottom` in the chat, because layout effects run in declaration order
 * and this one has to have the last word. The two only ever disagree in one situation — a
 * transcript short enough that the top and the bottom are both on screen — and there the reader
 * has just explicitly asked to look further back, so their position outranks following the newest
 * turn.
 */
export function useAnchorOnPrepend(ref: RefObject<HTMLElement | null>, key: number) {
  const mark = useRef<{ height: number; top: number } | null>(null);

  /** Call immediately BEFORE asking for older content — this is the position to preserve. */
  const markPosition = useCallback(() => {
    const el = ref.current;
    if (el) mark.current = { height: el.scrollHeight, top: el.scrollTop };
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    const m = mark.current;
    if (!el || !m) return;
    mark.current = null;
    el.scrollTop = m.top + (el.scrollHeight - m.height);
    // Keyed on the count of prepended conversations: the mark is consumed on the render that
    // mounts them, and a failed or empty load never changes the key, so it simply expires unused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return markPosition;
}
