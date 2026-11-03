import { useState } from 'react';
import { CORRECTION_MAX_CHARS } from '@cadence/shared';
import { OwnAnswerField } from './OwnAnswerField.tsx';

export const NOT_QUITE = 'Not quite?';
export const WHATS_OFF = "What's off?";
export const NOT_QUITE_HINT = 'e.g. the beer was a pint, not a can';

/**
 * "Not quite?" under a read's rows (owner, 2026-11-02: "I can only really select Looks right —
 * what if it's wrong? How do I fix it or indicate what's wrong?"). A tap opens one line; what is
 * typed goes back with the same words and the rows as shown, and the coach reads it again
 * (POST /nutrition/meals/preview with `correction`). Reuses the typed-answer field so the Enter
 * rule and the send button cannot drift from the question rows'.
 */
export function NotQuiteField({ busy, onCorrect }: { busy?: boolean; onCorrect: (words: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fa-notquite">
      {open ? (
        <OwnAnswerField
          label={WHATS_OFF}
          placeholder={NOT_QUITE_HINT}
          canSend={(t) => !!t.trim()}
          disabled={busy}
          maxLength={CORRECTION_MAX_CHARS}
          onSend={(t) => {
            setOpen(false);
            onCorrect(t.trim());
          }}
        />
      ) : (
        <button type="button" className="fa-chip" disabled={busy} onClick={() => setOpen(true)}>
          {NOT_QUITE}
        </button>
      )}
    </div>
  );
}
