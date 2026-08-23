import { useState } from 'react';
import { correctMealItem } from '../../lib/api.ts';
import { GrowingTextarea } from '../../components/GrowingTextarea.tsx';
import type { DiaryRow } from './foodDiaryRows.ts';
import { itemNutrients, NO_NUMBERS } from './itemNutrients.ts';

/**
 * One logged food, opened — brief 05, and the answer to the brief's closing question.
 *
 *   "If the answer is 'open the meal, see the numbers, fix the name', then 03, 04 and 05 are ONE
 *    SURFACE rather than three — and the confirm card is that same surface, shown earlier."
 *
 * It is. This shows what a food contributed and offers the three repairs the dill-pickle incident
 * actually needed. A rename keeps every number and fixes only the label — which is the move that
 * case wanted ("we might not have the right name but we definitely have the right nutrients") and
 * also how the ledger improves, because a corrected name on good nutrients is a good row. It
 * reaches backwards into the pinned food, so the wrong name stops resolving tomorrow.
 *
 * The vendor is editable here because it is captured and never shown anywhere else — "couchetard
 * or K." went into the ledger verbatim and no screen has ever admitted it.
 *
 * Confirm first applies to a correction too: nothing is written until a tap, and the sheet says
 * what the tap will do before it does it.
 */
export function MealItemSheet({
  row,
  siblings,
  onClose,
  onChanged,
}: {
  row: DiaryRow;
  /** The other items on the same meal — what a merge can fold this one into. */
  siblings: DiaryRow[];
  onClose: () => void;
  /** Something was written — the day's numbers moved, so whoever owns them should re-read. It
   *  carries no payload on purpose: a correction can also REMOVE the meal, and a caller that
   *  patched its own state from a returned row would be holding a meal that no longer exists. */
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'read' | 'rename' | 'merge' | 'drop'>('read');
  const [name, setName] = useState(row.name);
  const [brand, setBrand] = useState(row.brand ?? '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const nutrients = itemNutrients(row.macros);
  // A meal with no item breakdown has no addressable item, so it can be read but not repaired.
  const correctable = row.index != null;
  const mergeInto = siblings.filter((s) => s.logId === row.logId && s.index !== row.index && s.index != null);

  async function run(op: Parameters<typeof correctMealItem>[1]) {
    setBusy(true);
    setFailed(false);
    const updated = await correctMealItem(row.logId, op);
    setBusy(false);
    if (!updated) return setFailed(true);
    onChanged();
    onClose();
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet mis" role="dialog" aria-label={row.name}>
        <div className="sheet-grab" aria-hidden />

        <header className="mis-head">
          <h3 className="mis-name">{row.name}</h3>
          <p className="mis-sub">{[row.brand, row.amount].filter(Boolean).join(' · ') || 'no amount recorded'}</p>
        </header>

        {mode === 'read' && (
          <>
            {nutrients.length > 0 ? (
              <dl className="mis-nut">
                {nutrients.map((n) => (
                  <div className={`mis-nut-row${n.ceiling ? ' is-ceiling' : ''}`} key={n.key}>
                    <dt>
                      {n.label}
                      {/* Said, not styled. A ceiling drawn like a floor is bad advice; a ceiling
                          drawn in alarm colours is a scoreboard. So it gets a word. */}
                      {n.ceiling && <i className="mis-ceil">one to stay under</i>}
                    </dt>
                    <dd>{n.text}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mis-empty">{NO_NUMBERS}</p>
            )}

            {correctable && (
              <div className="mis-acts">
                <button className="mis-act" onClick={() => setMode('rename')}>
                  Fix the name
                </button>
                {mergeInto.length > 0 && (
                  <button className="mis-act" onClick={() => setMode('merge')}>
                    Same as another item
                  </button>
                )}
                <button className="mis-act is-quiet" onClick={() => setMode('drop')}>
                  I didn’t eat this
                </button>
              </div>
            )}
          </>
        )}

        {mode === 'rename' && (
          <div className="mis-form">
            <p className="mis-note">The numbers stay as they are — this only changes what it’s called.</p>
            <span className="mis-lab">What it was</span>
            <GrowingTextarea
              value={name}
              onChange={setName}
              ariaLabel="What this food was"
              placeholder="dill pickle peanuts"
            />
            <label className="mis-lab" htmlFor="mis-brand">
              Where it came from
            </label>
            <input
              id="mis-brand"
              className="mis-input"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Couche-Tard"
            />
            <button
              className="fa-log"
              disabled={busy || !name.trim()}
              onClick={() =>
                void run({ op: 'rename', index: row.index!, name: name.trim(), brand: brand.trim() || null })
              }
            >
              {busy ? 'Saving…' : 'Save the name'}
            </button>
          </div>
        )}

        {mode === 'merge' && (
          <div className="mis-form">
            <p className="mis-note">
              I’ll fold this one’s nutrition into whichever you pick, and take this row off the meal.
            </p>
            {mergeInto.map((s) => (
              <button
                key={s.key}
                className="mis-act"
                disabled={busy}
                onClick={() => void run({ op: 'merge', index: row.index!, into: s.index! })}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {mode === 'drop' && (
          <div className="mis-form">
            <p className="mis-note">
              This comes off the meal and the day’s numbers come down with it. Nothing else changes.
            </p>
            <button className="fa-log" disabled={busy} onClick={() => void run({ op: 'drop', index: row.index! })}>
              {busy ? 'Removing…' : `Take “${row.name}” off`}
            </button>
          </div>
        )}

        {failed && <p className="mis-note">That didn’t save. Your meal is unchanged — have another go?</p>}

        <button className="lockbtn ghost" onClick={() => (mode === 'read' ? onClose() : setMode('read'))}>
          {mode === 'read' ? 'Close' : 'Back'}
        </button>
      </div>
    </>
  );
}
