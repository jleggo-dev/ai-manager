import { TONE } from './tone.ts';

/**
 * The row of set chips under a tool that works in sets — one chip per set, in the order you'll do
 * them. Drawn once here for the reps counter and the timed-sets clock (walkthrough v3, design B),
 * so the two never drift: a logged chip is green (done is green, owner 2026-11-02) and names what
 * was logged; the set in hand is amber-edged and shows its live value, or a dot when nothing is on
 * it yet; the rest are blank. Tapping a logged chip re-opens that set for editing.
 */
export interface LoggedChip {
  /** What was logged, as the chip writes it ("12", "45 s"). */
  label: string;
  /** Off the target — a colour change on the number, never a warning. */
  off: boolean;
}

export function SetChips({
  count,
  logged,
  current,
  onEdit,
}: {
  count: number;
  logged: LoggedChip[];
  /** The set in hand: its index and, when something is on it, what the chip shows. */
  current: { index: number; label?: string } | null;
  onEdit?: (index: number) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, borderTop: '1px solid oklch(93% 0.012 85)', paddingTop: 13 }}>
      {Array.from({ length: count }).map((_, i) => {
        const done = logged[i];
        const isCurrent = !done && current?.index === i;
        const live = isCurrent ? current?.label : undefined;
        return (
          <div
            key={i}
            onClick={done && onEdit ? () => onEdit(i) : undefined}
            style={{
              flex: 1,
              textAlign: 'center',
              borderRadius: 12,
              padding: '8px 0',
              background: done ? DONE_BG : 'white',
              border: `1.5px solid ${done ? DONE_EDGE : isCurrent ? TONE.fillA : 'oklch(93% 0.012 85)'}`,
              cursor: done && onEdit ? 'pointer' : 'default',
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 900,
                lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums',
                color: done ? (done.off ? TONE.off : TONE.greenEdge) : live ? TONE.chipInk : 'oklch(78% 0.015 85)',
              }}
            >
              {done ? done.label : live ? live : isCurrent ? '·' : '—'}
            </div>
            <div
              style={{
                fontSize: 9,
                fontWeight: 900,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: done ? DONE_INK : 'oklch(66% 0.015 85)',
              }}
            >
              Set {i + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const DONE_BG = 'oklch(95% 0.03 152)';
const DONE_EDGE = 'oklch(66% 0.11 152)';
const DONE_INK = 'oklch(42% 0.06 152)';
