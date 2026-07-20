import { useState } from 'react';

/**
 * Draft-while-focused / commit-on-blur input helper.
 * Keeps the raw edit string (or structured draft) out of the committed store so
 * lossy unit conversions never run on every keystroke.
 */
export function useDraftField<T>(
  committed: T,
  commit: (draft: T) => void,
): {
  shown: T;
  setDraft: (value: T) => void;
  onBlur: () => void;
} {
  const [draft, setDraft] = useState<T | null>(null);
  const shown = draft !== null ? draft : committed;
  const onBlur = () => {
    const raw = draft;
    setDraft(null);
    if (raw !== null) commit(raw);
  };
  return { shown, setDraft, onBlur };
}
