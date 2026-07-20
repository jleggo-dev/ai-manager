/**
 * Daily macro-target editor (N3 "later tweaks"). Collapsed until opened; loads current targets,
 * lets the user set/adjust each field, and clear them entirely (back to observe-style). Only
 * appears once targets exist OR the user opens it — a books-only user never sees macro chrome
 * here either. Targets load via the shared nutrition-day query (CROSS-03).
 */
import { useState, useEffect } from 'react';
import { useInvalidateNutritionDay, useNutritionDay } from '../../lib/query/index.ts';
import { setMacroTargets, clearMacroTargets, type MealMacros } from '../../lib/api.ts';

const MK = [
  { k: 'kcal', label: 'Calories', unit: 'kcal' },
  { k: 'protein_g', label: 'Protein', unit: 'g' },
  { k: 'carbs_g', label: 'Carbs', unit: 'g' },
  { k: 'fat_g', label: 'Fat', unit: 'g' },
] as const;

export function NutritionTargets() {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [has, setHas] = useState<boolean | null>(null); // null = not loaded yet
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const { data: day, isError, isFetched } = useNutritionDay();
  const invalidateNutritionDay = useInvalidateNutritionDay();

  useEffect(() => {
    if (!isFetched) return;
    if (isError) {
      setHas(false);
      return;
    }
    const t = day?.targets ?? null;
    setHas(!!t && Object.keys(t).length > 0);
    if (t) setVals(Object.fromEntries(MK.map(({ k }) => [k, t[k] != null ? String(t[k]) : ''])));
  }, [day, isError, isFetched]);

  if (has === null || (!has && !open)) {
    // Hidden until it exists; a subtle way in for users who want to set them manually.
    return has === false ? (
      <button className="set-row" onClick={() => setOpen(true)}>
        <b>Daily nutrition targets</b>
        <span>Set calorie & macro goals — or let your coach propose them</span>
      </button>
    ) : null;
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setNote('');
    const body: MealMacros = {};
    for (const { k } of MK) {
      const n = Number(vals[k]);
      if (Number.isFinite(n) && n > 0) body[k] = n;
    }
    try {
      const saved = await setMacroTargets(body);
      if (saved) {
        setHas(true);
        setNote('Saved — your day now shows what’s left.');
        await invalidateNutritionDay();
      } else setNote('Those numbers didn’t look right — check the ranges and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      if (await clearMacroTargets()) {
        setHas(false);
        setOpen(false);
        setVals({});
        await invalidateNutritionDay();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="set-targets">
      <div className="set-targets-t">Daily nutrition targets</div>
      <div className="set-targets-grid">
        {MK.map(({ k, label, unit }) => (
          <label className="set-target" key={k}>
            <span>{label}</span>
            <input
              className="wiz-in"
              type="number"
              inputMode="numeric"
              value={vals[k] ?? ''}
              placeholder={unit}
              disabled={busy}
              onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {note && (
        <div className="sheet-msg" style={{ padding: '2px 0 6px' }}>
          {note}
        </div>
      )}
      <div className="set-targets-actions">
        <button className="lockbtn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save targets'}
        </button>
        {has && (
          <button className="set-danger-btn" onClick={clear} disabled={busy}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
