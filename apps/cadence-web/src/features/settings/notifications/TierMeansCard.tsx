import { NUDGE_LABEL } from '@cadence/shared';
import { useNotificationPrefs } from './useNotificationPrefs.ts';

/**
 * "MODERATE MEANS" — the promise, in full, both halves of it.
 *
 * Listing what a tier INCLUDES is the easy half and every app does it. Listing what it LEAVES OUT
 * is the half that makes this a setting rather than a sales page: a user choosing "few" deserves
 * to see, at the moment they choose, exactly what they are giving up — and a user on "moderate"
 * deserves to know that Cadence is holding three things back rather than wondering whether it
 * simply has nothing to say.
 *
 * The lists come from the server's own resolution of the tier (see the prefs route), so this card
 * cannot claim something the gate would not actually deliver.
 */
export function TierMeansCard() {
  const { data: prefs } = useNotificationPrefs();
  if (!prefs) return null;

  return (
    <div className="tier-means">
      <div className="tier-means-t">{prefs.tier.toUpperCase()} MEANS</div>

      <ul className="tier-means-list">
        {prefs.includes.map((kind) => (
          <li key={kind}>
            <span aria-hidden>·</span> {NUDGE_LABEL[kind]}
          </li>
        ))}
      </ul>

      {prefs.excludes.length > 0 && (
        <>
          <div className="tier-means-t tier-means-off">AND NOT</div>
          <ul className="tier-means-list tier-means-list-off">
            {prefs.excludes.map((kind) => (
              <li key={kind}>
                <span aria-hidden>·</span> {NUDGE_LABEL[kind]}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="tier-means-cap">
        {prefs.maxPerDay === 1 ? 'At most one a day.' : `At most ${prefs.maxPerDay} a day.`}
      </div>
    </div>
  );
}
