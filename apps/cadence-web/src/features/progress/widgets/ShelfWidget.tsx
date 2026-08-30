import type { ShelfPayload } from '@cadence/shared';

/**
 * `shelf` — bests & firsts, a collection of moments with no axis. Reuses the existing .hist-row
 * markup verbatim (styles.css), with the "event" dot modifier so every row reads warm (dawn-3) —
 * unlike `history`, a shelf never mixes in the neutral sage dot; everything on it is an accomplishment.
 */
export function ShelfWidget({ data }: { data: ShelfPayload }) {
  return (
    <div>
      {data.events.map((e, i) => (
        <div className="hist-row" key={`${e.label}-${i}`}>
          <span className="hist-dot hist-dot-event" />
          <div className="hist-t">
            <b>{e.label}</b>
          </div>
          <span className="hist-date">{e.at.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
