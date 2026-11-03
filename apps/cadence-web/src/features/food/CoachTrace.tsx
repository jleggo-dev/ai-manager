import type { MealPreview } from '../../lib/api.ts';
import { sentence, traceSummary } from './traceSummary.ts';

/**
 * The coach's work on a described meal, drawn the way a tool call is drawn in a chat: one short
 * line that says what ran ("3 parts looked up · 2 calls") and opens on a tap to show each part's
 * own line from the fan-out's report. The lines were drawn as a paragraph on the card — "Checked
 * fried chicken wings: your foods: 8 already on file · USDA: 10 imported · FatSecret: 5 rows; …"
 * — and the owner ruled against it (2026-11-02): showing that tools ran is fine, the details on
 * a tap are fine, a summary of row counts presented as if it meant something is not. What was
 * NOT read stays in the open: a part left out in silence reads as a meal that never had it.
 *
 * The summary is table-tested (CoachTrace.test.tsx) because it is built from the lines themselves
 * and never from canned copy: a remembered part says "picked before" in its line, and is counted
 * as such.
 */

export function CoachTrace({ coach, className }: { coach: MealPreview['coach']; className?: string }) {
  const lines = coach?.checked ?? [];
  const notRead = coach?.not_read ?? [];
  if (!lines.length && !notRead.length) return null;
  return (
    <div className={`ct${className ? ` ${className}` : ''}`}>
      {lines.length > 0 && (
        <details className="ct-work">
          <summary>{traceSummary(lines, coach?.calls)}</summary>
          <ul>
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      )}
      {notRead.length > 0 && <div className="ct-left">Not read: {sentence(notRead)}</div>}
    </div>
  );
}
