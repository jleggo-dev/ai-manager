import type { RecapRailPayload } from '@cadence/shared';

/**
 * `recap_rail` — a horizontal rail of weekly check-in cards. `week_of` is shown as a mono
 * uppercase label; `facts_line` is the computed numbers, `line` is the coach's one sentence
 * (plain text, plain color — the conclusion is written once at confirm-time and never recomputed).
 * A detoured week gets no red flag, just its `detour` bit for the caller to note elsewhere.
 */
export function RecapRailWidget({ data }: { data: RecapRailPayload }) {
  return (
    <div className="pw-rail">
      {data.recaps.map((r, i) => (
        <div className="pw-rail-card" key={`${r.week_of}-${i}`}>
          <div className="pw-rail-week">WEEK OF {r.week_of}</div>
          <div className="pw-rail-facts">{r.facts_line}</div>
          <div className="pw-rail-line">{r.line}</div>
        </div>
      ))}
    </div>
  );
}
