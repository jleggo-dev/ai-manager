import { useState } from 'react';
import { NUDGE_TIERS, type NudgeTier } from '@cadence/shared';
import { forgetPushDevice, registerPushDevice } from './enablePush.ts';
import { useNotificationPrefs, useSaveNotificationPrefs } from './useNotificationPrefs.ts';

/**
 * Off / Few / Moderate / Lots — the only volume control there is (owner, 2026-09-07:
 * "Notifications should have an Off option").
 *
 * Named amounts rather than nine switches, because nine switches is a configuration screen and a
 * configuration screen produces combinations nobody designed. A segmented control, not a slider:
 * the positions are discrete promises about what will arrive, and a slider would imply a continuum
 * with meaningful positions between them. Labels only — no gloss, no card underneath.
 *
 * "Off" is not a fourth tier. `NudgeTier` stays few|moderate|lots; Off is `prefs.enabled === false`
 * plus this device's push token forgotten — what the old separate push switch did. Picking an
 * amount while off runs the enable path first (iOS permission → APNs token → server registration)
 * and only then saves `enabled: true` with the tier, in one round trip, so the dial never shows an
 * amount that nothing can actually deliver.
 *
 * The push channel is the ONLY channel. There is no email row and no text-message row, and that
 * absence is a decision rather than a gap.
 */
const TIER_LABEL: Record<NudgeTier, string> = { few: 'Few', moderate: 'Moderate', lots: 'Lots' };

type Position = NudgeTier | 'off';

export function TierDial() {
  const { data: prefs } = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!prefs) return null;

  const off = !prefs.enabled;
  const current: Position = off ? 'off' : prefs.tier;

  async function turnOff() {
    await forgetPushDevice();
    await save.mutateAsync({ enabled: false });
  }

  async function turnTo(tier: NudgeTier) {
    if (!off) {
      await save.mutateAsync({ tier });
      return;
    }
    const outcome = await registerPushDevice();
    if (outcome === 'denied') {
      setMsg('iOS said no — you can change that anytime in Settings → Notifications.');
      return;
    }
    if (outcome !== 'on') {
      setMsg("That didn't save — try again in a moment.");
      return;
    }
    await save.mutateAsync({ enabled: true, tier });
  }

  async function pick(next: Position) {
    if (busy || next === current) return;
    setBusy(true);
    setMsg('');
    try {
      await (next === 'off' ? turnOff() : turnTo(next));
    } catch {
      setMsg("That didn't work — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const positions: Position[] = ['off', ...NUDGE_TIERS];

  return (
    <>
      <div className="tier-dial" role="radiogroup" aria-label="Notifications">
        {positions.map((pos) => {
          const active = pos === current;
          return (
            <button
              key={pos}
              type="button"
              role="radio"
              aria-checked={active}
              className={`tier-seg${active ? ' tier-seg-on' : ''}`}
              disabled={busy || save.isPending}
              onClick={() => void pick(pos)}
            >
              <b>{pos === 'off' ? 'Off' : TIER_LABEL[pos]}</b>
            </button>
          );
        })}
      </div>
      {msg && <div className="auth-notice">{msg}</div>}
    </>
  );
}
