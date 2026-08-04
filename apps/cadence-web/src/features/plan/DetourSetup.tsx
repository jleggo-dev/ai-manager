import { useState } from 'react';
import type { ActiveEpisode } from '../../lib/api.ts';

/** The self-declare detour types (Req 4) — the coach names each plainly (BRAND.md). */
const DETOUR_TYPES: Array<{ type: ActiveEpisode['type']; label: string }> = [
  { type: 'travel', label: 'Traveling' },
  { type: 'illness', label: 'Unwell' },
  { type: 'injury', label: 'An injury' },
  { type: 'recovery', label: 'Recovering' },
  { type: 'custom', label: 'A rough stretch' },
];

/** Windows people actually describe. Anything longer is a re-baseline conversation, not a detour. */
const WINDOWS = [
  { days: 3, label: 'A few days' },
  { days: 7, label: 'About a week' },
  { days: 14, label: 'Two weeks' },
];

/**
 * Common enough to be worth one tap. Free text covers the rest — this is a prompt, not a taxonomy,
 * and someone in an airport should not be filling in a form.
 */
const COMMON_GEAR = ['Hotel gym', 'Dumbbells', 'Treadmill', 'Resistance band', 'Pool', 'Just my shoes'];

export interface DetourChoice {
  type: ActiveEpisode['type'];
  days: number;
  available_equipment: { name: string }[];
}

/**
 * The detour check-in — three questions, because **Cadence cannot re-plan a week without knowing
 * the schedule and the equipment** (owner, 2026-08-04). Before this, tapping "Traveling" drafted
 * the temporary plan against an EMPTY equipment list and a guessed window: the coach was told you
 * had nothing, for a length nobody chose.
 *
 * The framing matters as much as the fields. A detour is not a lighter week you have to earn — it
 * is about **preserving the habits you can preserve** when the schedule gets thrown out. So the
 * gear question is "what have you got with you", never "what can you still manage", and none of
 * the copy treats the disruption as a lapse.
 *
 * Nothing here is required: skipping the gear means no gear, which is a real and common answer.
 */
export function DetourSetup({
  onEnter,
  onCancel,
}: {
  onEnter: (choice: DetourChoice) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<ActiveEpisode['type'] | null>(null);
  const [days, setDays] = useState(7);
  const [gear, setGear] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (name: string) => setGear((g) => (g.includes(name) ? g.filter((x) => x !== name) : [...g, name]));

  async function enter() {
    if (!type || busy) return;
    setBusy(true);
    const extra = other
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await onEnter({ type, days, available_equipment: [...gear, ...extra].map((name) => ({ name })) });
  }

  return (
    <div className="detour-pick">
      <span className="detour-pick-label">
        Take a detour — your plan pauses for a bit, it never resets. Tell me the shape of it and I&rsquo;ll keep what we
        can keep.
      </span>

      <div className="detour-chips">
        {DETOUR_TYPES.map((d) => (
          <button
            key={d.type}
            className={`detour-chip ${type === d.type ? 'on' : ''}`}
            aria-pressed={type === d.type}
            onClick={() => setType(d.type)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {type && (
        <>
          <div className="detour-q">How long, roughly?</div>
          <div className="detour-chips">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                className={`detour-chip ${days === w.days ? 'on' : ''}`}
                aria-pressed={days === w.days}
                onClick={() => setDays(w.days)}
              >
                {w.label}
              </button>
            ))}
          </div>

          <div className="detour-q">What have you got with you?</div>
          <div className="detour-chips">
            {COMMON_GEAR.map((g) => (
              <button
                key={g}
                className={`detour-chip ${gear.includes(g) ? 'on' : ''}`}
                aria-pressed={gear.includes(g)}
                onClick={() => toggle(g)}
              >
                {g}
              </button>
            ))}
          </div>
          <input
            className="detour-other"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Anything else? (comma separated)"
          />

          <div className="detour-chips">
            <button className="detour-go" disabled={busy} onClick={() => void enter()}>
              {busy ? 'Setting up…' : 'Start the detour'}
            </button>
            <button className="adhoc-cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {!type && (
        <button className="adhoc-cancel" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
