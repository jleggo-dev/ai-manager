import type { RhythmPayload, RhythmDayState } from '@cadence/shared';

/**
 * `rhythm` — dot-rows of weeks. Brand physics lives here, enforced by construction rather than by
 * prompt: kept is forest, missed is neutral (never red, never a broken streak), an 'unscheduled'
 * day simply isn't drawn (absent data reads "not read", not zero), and a detour renders its whole
 * week on a quiet shelter band with the check-ins that happened inside it — never a penalty.
 */

function checkinCount(days: { state: RhythmDayState }[]): number {
  return days.filter((d) => d.state === 'checkin').length;
}

export function RhythmWidget({ data }: { data: RhythmPayload }) {
  return (
    <div className="pw-rhythm">
      {data.weeks.map((week) => {
        const detour = week.detour;
        const checkins = checkinCount(week.days);
        const rightCaption = detour
          ? `${checkins} check-in${checkins === 1 ? '' : 's'}`
          : `${week.kept} of ${week.scheduled}`;
        return (
          <div key={week.start} className={`pw-rhythm-row${detour ? ' pw-rhythm-row--detour' : ''}`}>
            <span className="pw-rhythm-label">{week.label}</span>
            {detour && <span className="pw-rhythm-badge">{detour.label}</span>}
            <span className="pw-rhythm-dots">
              {week.days
                .filter((d) => d.state !== 'unscheduled')
                .map((d) => (
                  <span key={d.date} className={`pw-rhythm-dot pw-rhythm-dot--${d.state}`} />
                ))}
            </span>
            <span className="pw-rhythm-count">{rightCaption}</span>
          </div>
        );
      })}
      <div className="pw-footer">a missed day is information, not failure</div>
    </div>
  );
}
