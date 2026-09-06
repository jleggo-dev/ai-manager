import { useState } from 'react';
import { AXIS_LABEL, UNIT_AXES, UNIT_LABEL, axisOptions, type UnitAxis, type UnitPrefs } from '@cadence/shared';
import { setUnits } from '../../lib/api.ts';
import { useSetUnits, useUnits } from '../../lib/query/index.ts';

/**
 * Units, one control per axis.
 *
 * Owner, 2026-08-22, describing his own kitchen and gym: pounds for himself, feet and inches for
 * his height, grams for food, cups and spoons for food volume, kilometres for distance. A single
 * metric/imperial switch cannot express any of that — set it to imperial and you get grams-free
 * recipes nobody cooks from; set it to metric and you are told your bodyweight in kilos you do not
 * think in. So five controls, each independent.
 *
 * ITS OWN FILE on purpose. `SettingsSheet.tsx` is being edited in another branch right now, so the
 * only line this change adds there is the one that mounts this — a conflict small enough to resolve
 * without reading anyone's mind.
 *
 * Saves per tap and shows nothing but the result. There is no Save button because there is nothing
 * to get wrong: an axis has two values and the change is instant and reversible.
 */
export function UnitSettings() {
  // The same shared units entry the trail, the rows and the quiet-hours chip read the clock from
  // (lib/query/useUnits.ts) — so these controls are on screen with the rest of Settings rather than
  // a round trip after it, and a tap here reaches every one of those surfaces at once.
  const { data } = useUnits();
  const writeUnits = useSetUnits();
  const resolved = data?.resolved ?? null;
  const [busy, setBusy] = useState<UnitAxis | null>(null);
  const [err, setErr] = useState('');

  async function choose(axis: UnitAxis, unit: string) {
    if (busy) return;
    setBusy(axis);
    setErr('');
    // Optimistic: the control is a toggle over two known values, so the answer is never a surprise.
    writeUnits((prev) => (prev ? { ...prev, resolved: { ...prev.resolved, [axis]: unit } } : prev));
    const out = await setUnits({ [axis]: unit } as Partial<UnitPrefs>);
    if (out) writeUnits(() => out);
    else setErr("That didn't save — try again in a moment.");
    setBusy(null);
  }

  if (!resolved) return null;

  return (
    <section className="set-block" aria-label="Units">
      <h3 className="set-h">Units</h3>
      {/* Canonical copy (Settings Room, owner-approved 2026-08-31) — lifted verbatim. */}
      <p className="set-note">Set these however you actually talk — most people mix them.</p>

      {UNIT_AXES.map((axis) => {
        const [metric, imperial] = axisOptions(axis);
        const current = resolved[axis];
        return (
          <div className="set-row set-row-split" key={axis}>
            <span className="set-row-l">{AXIS_LABEL[axis]}</span>
            <span className="set-seg" role="group" aria-label={AXIS_LABEL[axis]}>
              {[metric, imperial].map((u) => (
                <button
                  key={u}
                  type="button"
                  className={u === current ? 'set-seg-b on' : 'set-seg-b'}
                  aria-pressed={u === current}
                  disabled={busy === axis}
                  onClick={() => void choose(axis, u)}
                >
                  {UNIT_LABEL[u] ?? u}
                </button>
              ))}
            </span>
          </div>
        );
      })}

      {err && <p className="set-note">{err}</p>}
    </section>
  );
}
