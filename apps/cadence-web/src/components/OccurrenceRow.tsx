import type { PlanOccurrence } from '../lib/api.ts';
import { isOccurrenceOpenable, occMod, type OccMod } from './occurrence-mod.ts';

/** Quiet module glyph so the day's checklist reads at a glance (S6 #1). */
function ModIcon({ mod }: { mod: OccMod }) {
  if (mod === 'nutrition') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
        <circle className="stroke" cx="8" cy="8" r="6" />
        <circle className="stroke" cx="8" cy="8" r="2.2" />
      </svg>
    );
  }
  if (mod === 'weigh') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
        <path className="stroke" d="M2.5 11a5.5 5.5 0 0 1 11 0" strokeLinecap="round" />
        <path className="stroke" d="M8 11l3-3.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path className="stroke" d="M2.5 10.5l3.2-5 2.6 3 2.4-4.4L14 9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type OccurrenceRowVariant = 'dashboard' | 'week';

/**
 * Shared check / skip / open occurrence row for Today's rhythm and the Week list.
 * `dashboard` adds the module-icon badge; `week` keeps the leaner list row.
 */
export function OccurrenceRow({
  o,
  variant,
  onCheck,
  onOpen,
}: {
  o: PlanOccurrence;
  variant: OccurrenceRowVariant;
  onCheck: (o: PlanOccurrence, status: 'pending' | 'done' | 'skipped') => void;
  onOpen: (occId: string) => void;
}) {
  const done = o.status === 'done';
  const skipped = o.status === 'skipped';
  // A base occurrence shelved for a detour (Req 4): shown muted + non-actionable, never a red mark.
  const paused = o.status === 'paused';
  const openable = isOccurrenceOpenable(o) && !paused;
  const openTitle = variant === 'dashboard' ? 'Open' : 'See the session';

  return (
    <div className={`occ${done ? ' occ-done' : ''}${skipped ? ' occ-skip' : ''}${paused ? ' occ-paused' : ''}`}>
      {paused ? (
        <span className="occ-check occ-check-static" aria-hidden>
          –
        </span>
      ) : (
        <button
          className="occ-check"
          onClick={() => onCheck(o, done ? 'pending' : 'done')}
          aria-label={done ? 'Mark not done' : 'Mark done'}
        >
          {done ? '✓' : skipped ? '–' : ''}
        </button>
      )}
      {variant === 'dashboard' && (
        <span className={`occ-mod occ-mod-${occMod(o)}`}>
          <ModIcon mod={occMod(o)} />
        </span>
      )}
      {openable ? (
        <button className="occ-body occ-open" onClick={() => onOpen(o.occurrence_id)} title={openTitle}>
          <span className="occ-title">{o.title}</span>
          {o.time_of_day && <span className="occ-time">{o.time_of_day}</span>}
        </button>
      ) : (
        <div className="occ-body">
          <span className="occ-title">{o.title}</span>
          {o.time_of_day && <span className="occ-time">{o.time_of_day}</span>}
        </div>
      )}
      {paused ? (
        <span className="occ-pausetag">paused</span>
      ) : (
        !done && (
          <button className="occ-skipbtn" onClick={() => onCheck(o, skipped ? 'pending' : 'skipped')}>
            {skipped ? 'undo' : 'skip'}
          </button>
        )
      )}
    </div>
  );
}
