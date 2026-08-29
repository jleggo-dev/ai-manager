import type { CSSProperties } from 'react';
import { useWatchHandoff } from './useWatchHandoff.ts';
import type { OccurrenceSession } from '@cadence/shared';

/**
 * The one visible piece of the A13 hand-off: a quiet row under the session's Start button.
 *
 * Renders nothing at all unless the whole chain said yes (see useWatchHandoff). Sent state says
 * where the session went in plain words — it sits in the watch's own Workout app on its day, with
 * our name on it; Apple runs the workout, and the result finds its way back on its own.
 */
export function WatchHandoffRow({
  occurrenceId,
  title,
  dateISO,
  session,
  pending,
}: {
  occurrenceId: string;
  title: string;
  dateISO: string;
  session: OccurrenceSession | null | undefined;
  pending: boolean;
}) {
  const { visible, phase, send, remove } = useWatchHandoff({
    occurrenceId,
    title,
    dateISO,
    session,
    pending,
  });
  if (!visible) return null;

  if (phase === 'sent') {
    return (
      <div style={row}>
        <span style={sentText}>⌚ On your watch for {weekdayOf(dateISO)}</span>
        <button style={ghostBtn} onClick={() => void remove()}>
          Take it off
        </button>
      </div>
    );
  }

  return (
    <div style={row}>
      <button style={sendBtn} disabled={phase === 'sending'} onClick={() => void send()}>
        {phase === 'sending' ? 'Sending…' : '⌚ Send to your watch'}
      </button>
      {phase === 'failed' && <span style={failText}>It didn’t land — try again in a moment.</span>}
    </div>
  );
}

/** The day in a word — the sheet already shows the full date, so the receipt can be warm. */
function weekdayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!y || !m || !d) return 'its day';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' });
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  margin: '0 0 12px',
};
const sendBtn: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid var(--forest, #3f7a52)',
  fontWeight: 700,
  fontSize: 13,
  color: 'var(--forest, #3f7a52)',
  background: 'transparent',
  cursor: 'pointer',
};
const ghostBtn: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: 'none',
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--ink-soft, #6b6b66)',
  background: 'transparent',
  cursor: 'pointer',
};
const sentText: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--forest, #3f7a52)' };
const failText: CSSProperties = { fontSize: 12, color: 'var(--ink-soft, #6b6b66)' };
