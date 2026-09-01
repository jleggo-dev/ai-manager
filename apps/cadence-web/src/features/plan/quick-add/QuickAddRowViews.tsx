import { useEffect, useState } from 'react';
import { displayWeightUnit } from '@cadence/shared';
import { getUnits, logWater, recordWeighInToday } from '../../../lib/api.ts';
import { useInvalidateNutritionDay, useUploadProgressPhoto } from '../../../lib/query/index.ts';
import { GLYPH } from '../../today/glyphs.ts';
import { GLASS_ML } from '../../nutrition/WaterRow.tsx';
import { downscalePhoto } from '../occurrence/format.ts';
import type { QuickAddArea } from './quickAddRows.ts';

/**
 * The quick-add sheet's screen-1 rows — one component per kind of capture, all wearing the
 * sheet's own `.ld-row` chrome. Which rows exist at all is quickAddRows.ts's decision; these only
 * know how to take the thing once offered: a pour is one tap, a weight is a number, a movement or
 * practice noun hands off to screen 2 (QuickAddTense.tsx), a photo is the camera. Nothing here
 * ticks a plan task — the trail owns those.
 */

function RowIcon({ cat, d }: { cat: string; d: string }) {
  return (
    <span className={`ld-ic ld-ic-${cat}`} aria-hidden>
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path d={d} fill="#fff" />
      </svg>
    </span>
  );
}

/** One tap, one glass — the same optimistic pour the food module's rows make (WaterRow.tsx). */
export function WaterQuickRow({ initialMl }: { initialMl: number }) {
  const [ml, setMl] = useState(initialMl);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateNutritionDay();

  async function pour() {
    if (busy) return;
    setBusy(true);
    setMl((m) => m + GLASS_ML); // optimistic — the total moves under the thumb
    try {
      const total = await logWater(GLASS_ML);
      if (total != null) setMl(total);
      void invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="ld-row" onClick={() => void pour()} disabled={busy} aria-label="Add a glass of water">
      <RowIcon cat="nutrition" d={GLYPH.bowl} />
      <span className="ld-row-t">
        <b>A glass of water</b>
        <span>{(ml / 1000).toFixed(1)} L today</span>
      </span>
      <span className="ld-plus" aria-hidden>
        ＋
      </span>
    </button>
  );
}

/** A door, not a form: meal capture belongs to the food module's Log screen (05b). */
export function MealQuickRow({ onOpenFood }: { onOpenFood: () => void }) {
  return (
    <button className="ld-row" onClick={onOpenFood} aria-label="Log a meal">
      <RowIcon cat="nutrition" d={GLYPH.fork} />
      <span className="ld-row-t">
        <b>Log a meal</b>
        <span>or a single thing you ate</span>
      </span>
      <span className="ld-plus" aria-hidden>
        ＋
      </span>
    </button>
  );
}

/**
 * The between-days weight entry (A23 §2c's daily path) — quickAddRows.ts already stood this row
 * down on a day whose trail carries its own weigh-in. Same input, same trend framing, and the
 * same phrasing as WeighInSettings, so the scale speaks one language everywhere.
 */
export function WeightQuickRow({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [unit, setUnit] = useState<'lb' | 'kg'>('lb');
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    getUnits()
      .then((r) => setUnit(displayWeightUnit(r?.resolved?.body_weight)))
      .catch(() => {});
  }, [open]);

  async function log() {
    const w = parseFloat(weight);
    if (!Number.isFinite(w) || w <= 0 || busy) return;
    setBusy(true);
    setNote('');
    try {
      await recordWeighInToday(w, unit);
      setWeight('');
      setNote("Noted — it feeds the trend, so today's number is only a part of it.");
    } catch {
      setNote("That didn't save — check the number and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="ld-row" onClick={onToggle} aria-label="Log a weight" aria-expanded={open}>
        <RowIcon cat="nutrition" d={GLYPH.gauge} />
        <span className="ld-row-t">
          <b>Log a weight</b>
          <span>it feeds your trend</span>
        </span>
        <span className="ld-plus" aria-hidden>
          ＋
        </span>
      </button>
      {open && (
        <div>
          {/* The settings sheet's own weigh entry (WeighInSettings), same classes and words. */}
          <div className="weigh-row">
            <input
              className="wiz-in"
              type="number"
              inputMode="decimal"
              value={weight}
              disabled={busy}
              aria-label="Today's weight"
              placeholder={unit === 'lb' ? 'e.g. 195' : 'e.g. 88.5'}
              onChange={(e) => setWeight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void log();
              }}
            />
            <button className="wiz-sel" disabled={busy} onClick={() => setUnit(unit === 'lb' ? 'kg' : 'lb')}>
              {unit} ⇄
            </button>
          </div>
          <button className="logbox-btn" disabled={busy || !weight.trim()} onClick={() => void log()}>
            {busy ? 'Noting it down…' : 'Add it to the trend'}
          </button>
          {note && <div className="ld-empty">{note}</div>}
        </div>
      )}
    </>
  );
}

const AREA_GLYPH: Record<QuickAddArea, string> = { movement: GLYPH.dumbbell, practice: GLYPH.note };

/**
 * Screen 1's noun row for an area the plan shows they work in (Activity Builder 2A) — "Piano", not
 * "Add a practice": `noun` is `quickAddRows.ts`'s derivation, this component only wears it. A tap
 * doesn't log anything itself; it hands off to screen 2 ("the tense" — `onSelect`), which is where
 * past/present actually happen. Deliberately NOT a tap on a plan activity: whatever gets logged
 * from screen 2 lands in that area's own off-plan bucket (lib/api `logAdhoc` `area`), so it counts
 * toward consistency + the streak without touching anything the trail already has a button for.
 */
export function AreaQuickRow({
  area,
  noun,
  toward,
  onSelect,
}: {
  area: QuickAddArea;
  noun: string;
  toward?: string;
  onSelect: () => void;
}) {
  return (
    <button className="ld-row" onClick={onSelect} aria-label={noun}>
      <RowIcon cat={area} d={AREA_GLYPH[area]} />
      <span className="ld-row-t">
        <b>{noun}</b>
        <span>{toward ? `toward ${toward}` : 'counts toward your week'}</span>
      </span>
      {/* A chevron, not the plus every other row wears — this tap opens a screen, it doesn't log
          anything by itself. */}
      <span className="ld-plus" aria-hidden>
        ›
      </span>
    </button>
  );
}

/** Same capture pattern as PhotosScreen's due card — but the FRONT camera (owner, 2026-09-01):
 *  a quick add is a selfie moment, unlike the screen's framed mirror shot. */
export function PhotoQuickRow() {
  const upload = useUploadProgressPhoto();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function pick(file: File | null | undefined) {
    if (!file || state === 'saving') return;
    setState('saving');
    try {
      const photo = await downscalePhoto(file);
      const stored = await upload.mutateAsync({ photo });
      setState(stored ? 'saved' : 'error');
    } catch {
      setState('error');
    }
  }

  const meta =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
        ? 'Saved — dated & weight-stamped'
        : state === 'error'
          ? "That didn't save — give it another try"
          : 'dated & weight-stamped automatically';

  return (
    <label className="ld-row" aria-label="Take a progress photo">
      <RowIcon cat="reflection" d={GLYPH.camera} />
      <span className="ld-row-t">
        <b>Take a progress photo</b>
        <span>{meta}</span>
      </span>
      <span className="ld-plus" aria-hidden>
        ＋
      </span>
      <input
        type="file"
        accept="image/*"
        capture="user"
        hidden
        disabled={state === 'saving'}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = ''; // same photo re-pickable
        }}
      />
    </label>
  );
}
