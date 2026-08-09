import { NUDGE_TIERS, type NudgeTier } from '@cadence/shared';
import { useNotificationPrefs, useSaveNotificationPrefs } from './useNotificationPrefs.ts';

/**
 * Few / Moderate / Lots — the only volume control there is.
 *
 * Three named amounts rather than nine switches, because nine switches is a configuration screen
 * and a configuration screen produces combinations nobody designed. It is a segmented control, not
 * a slider: the three are discrete promises about what will arrive, and a slider would imply a
 * continuum with meaningful positions between them.
 *
 * The labels carry a one-word gloss so the choice can be made without reading the card below —
 * though the card is what makes the promise, and it is always visible.
 */
const TIER_LABEL: Record<NudgeTier, string> = { few: 'Few', moderate: 'Moderate', lots: 'Lots' };
const TIER_GLOSS: Record<NudgeTier, string> = {
  few: 'only what happened',
  moderate: 'and timing help',
  lots: 'and the day itself',
};

export function TierDial() {
  const { data: prefs } = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  if (!prefs) return null;

  return (
    <div className="tier-dial" role="radiogroup" aria-label="How much your coach says">
      {NUDGE_TIERS.map((tier) => {
        const active = prefs.tier === tier;
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={active}
            className={`tier-seg${active ? ' tier-seg-on' : ''}`}
            disabled={save.isPending}
            onClick={() => {
              if (!active) save.mutate({ tier });
            }}
          >
            <b>{TIER_LABEL[tier]}</b>
            <span>{TIER_GLOSS[tier]}</span>
          </button>
        );
      })}
    </div>
  );
}
