/**
 * Settings Room 1d — "Nutrition": daily targets as steppers, plus the allergy/preference chips
 * that used to live in DietaryProfileEditor.tsx. Standalone: fetches its own data (the shared
 * `/nutrition/day` query for targets, `/nutrition/dietary-profile` for allergies/dislikes) and
 * takes only onBack/onCoach.
 *
 * SODIUM: `day.targets` is typed to carry `sodium_mg` (MealMacros mirrors the full `Macros` shape),
 * but no code path today can actually SET one — `sanitizeTargets` / `TARGET_RANGES` in
 * apps/cadence-api/src/services/nutrition-day.ts only range-checks kcal/protein_g/carbs_g/fat_g
 * ("MACROS ONLY, deliberately... micronutrient targets... are a lookup [never] proposed by
 * anyone"), so a submitted sodium_mg is silently dropped server-side even when the OTHER macros in
 * the same PUT validate fine. This row is built exactly to the design brief regardless — it reads
 * the condition honestly (`sodium_mg != null` on the loaded target) and saves through the same
 * `setMacroTargets` call as everything else — but until that gate gains a sodium range, a step on
 * this ONE row will visibly snap back after the post-save refetch. See the final report for the
 * exact file/lines an API-side fix would touch; out of scope here (apps/cadence-api is off limits
 * for this parcel).
 */
import { useEffect, useState } from 'react';
import type { DietaryProfile } from '@cadence/shared';
import { getDietaryProfile, saveDietaryProfile, setMacroTargets, type MealMacros } from '../../lib/api.ts';
import { useInvalidateNutritionDay, useNutritionDay } from '../../lib/query/index.ts';
import '../../styles/settings-editors.css';

type MacroKey = 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'sodium_mg';

const STEPPERS: Array<{ key: MacroKey; label: string; unit: string; step: number }> = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', step: 25 },
  { key: 'protein_g', label: 'Protein', unit: 'g', step: 5 },
  { key: 'carbs_g', label: 'Carbs', unit: 'g', step: 5 },
  { key: 'fat_g', label: 'Fat', unit: 'g', step: 5 },
];
/** No increment rode the design brief for sodium (only "row appears ONLY when already set") — 50mg
 *  is this parcel's pick, coarse enough to move a ~2300mg daily ceiling in a sane number of taps. */
const SODIUM_STEP = 50;

const RETARGET_NOTE =
  "They opened Nutrition in Settings and want help with what their targets should be — they didn't " +
  'change a number themselves, they want your read. Ask about their goal and current eating before ' +
  'proposing kcal/protein/carbs/fat (set_nutrition_targets); never propose a sodium or micronutrient ' +
  'target — those come from the reference table, not a guess.';

export function SettingsNutrition({ onBack, onCoach }: { onBack: () => void; onCoach?: (note: string) => void }) {
  return (
    <div className="fh">
      <div className="fh-head">
        <button className="fh-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <b className="fh-title">Nutrition</b>
      </div>
      <div className="fh-body">
        <div className="se-kicker">Targets · allergies · preferences</div>

        <TargetsCard />

        {onCoach && (
          <button className="se-coach-door" onClick={() => onCoach(RETARGET_NOTE)}>
            <b>Not sure what these should be?</b>
            <span>Ask Cadence to re-look.</span>
          </button>
        )}

        <AllergyPrefsCard />
      </div>
    </div>
  );
}

function TargetsCard() {
  const { data: day } = useNutritionDay();
  const invalidateNutritionDay = useInvalidateNutritionDay();
  const [vals, setVals] = useState<Record<MacroKey, number>>({
    kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    sodium_mg: 0,
  });
  const [hasSodium, setHasSodium] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!day) return;
    const t = day.targets ?? {};
    setVals({
      kcal: t.kcal ?? 0,
      protein_g: t.protein_g ?? 0,
      carbs_g: t.carbs_g ?? 0,
      fat_g: t.fat_g ?? 0,
      sodium_mg: t.sodium_mg ?? 0,
    });
    setHasSodium(t.sodium_mg != null);
  }, [day]);

  async function step(key: MacroKey, delta: number) {
    if (busy) return;
    const nextVals = { ...vals, [key]: Math.max(0, vals[key] + delta) };
    setVals(nextVals);
    setBusy(true);
    setNote('');
    const body: MealMacros = {
      kcal: nextVals.kcal || undefined,
      protein_g: nextVals.protein_g || undefined,
      carbs_g: nextVals.carbs_g || undefined,
      fat_g: nextVals.fat_g || undefined,
    };
    if (hasSodium) body.sodium_mg = nextVals.sodium_mg || undefined;
    try {
      const saved = await setMacroTargets(body);
      if (saved) await invalidateNutritionDay();
      else setNote("Those numbers didn't look right — check the ranges and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="se-card">
      <div className="se-card-t">Daily targets</div>
      {STEPPERS.map(({ key, label, unit, step: inc }) => (
        <StepperRow
          key={key}
          label={label}
          unit={unit}
          value={vals[key]}
          busy={busy}
          onStep={(d) => void step(key, d * inc)}
        />
      ))}
      {hasSodium && (
        <StepperRow
          label="Sodium"
          unit="mg"
          value={vals.sodium_mg}
          busy={busy}
          onStep={(d) => void step('sodium_mg', d * SODIUM_STEP)}
        />
      )}
      <div className="se-note">Change a number and Cadence is told right away — next meals plan against it.</div>
      {note && <div className="se-note">{note}</div>}
    </div>
  );
}

function StepperRow({
  label,
  unit,
  value,
  busy,
  onStep,
}: {
  label: string;
  unit: string;
  value: number;
  busy: boolean;
  onStep: (direction: 1 | -1) => void;
}) {
  return (
    <div className="se-stepper-row">
      <span className="se-stepper-label">{label}</span>
      <span className="se-stepper">
        <button
          type="button"
          className="se-stepper-btn"
          disabled={busy || value <= 0}
          aria-label={`Decrease ${label}`}
          onClick={() => onStep(-1)}
        >
          −
        </button>
        <span className="se-stepper-val">
          {value} <i>{unit}</i>
        </span>
        <button
          type="button"
          className="se-stepper-btn"
          disabled={busy}
          aria-label={`Increase ${label}`}
          onClick={() => onStep(1)}
        >
          +
        </button>
      </span>
    </div>
  );
}

function AllergyPrefsCard() {
  const [profile, setProfile] = useState<DietaryProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [allergyDraft, setAllergyDraft] = useState('');
  const [dislikeDraft, setDislikeDraft] = useState('');

  useEffect(() => {
    let alive = true;
    getDietaryProfile().then((r) => {
      if (alive) setProfile(r.profile);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function patch(next: Partial<DietaryProfile>) {
    if (!profile || busy) return;
    const updated = { ...profile, ...next };
    setProfile(updated);
    setBusy(true);
    try {
      const saved = await saveDietaryProfile(updated);
      if (saved) setProfile(saved);
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return null;

  return (
    <>
      <div className="se-card">
        <div className="se-group-t">Allergies</div>
        <div className="se-group-h">hard stops — only you can clear one</div>
        {profile.allergies.length > 0 && (
          <div className="se-chips">
            {profile.allergies.map((a) => (
              <span className="se-chip se-chip-warm" key={a}>
                {a}
                <button
                  type="button"
                  className="se-chip-x se-chip-x-warm"
                  disabled={busy}
                  aria-label={`Remove ${a}`}
                  onClick={() => void patch({ allergies: profile.allergies.filter((x) => x !== a) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <ChipAdd
          draft={allergyDraft}
          setDraft={setAllergyDraft}
          busy={busy}
          placeholder='e.g. "peanuts"'
          onAdd={() => {
            const t = allergyDraft.trim();
            if (!t) return;
            void patch({ allergies: [...profile.allergies, t] });
            setAllergyDraft('');
          }}
        />
        <div className="se-note">Cadence can add one if she spots it in conversation — she can never remove one.</div>
      </div>

      <div className="se-card">
        <div className="se-group-t">Rather skip</div>
        <div className="se-group-h">soft — I&apos;ll steer around them</div>
        {profile.dislikes.length > 0 && (
          <div className="se-chips">
            {profile.dislikes.map((d) => (
              <span className="se-chip" key={d}>
                {d}
                <button
                  type="button"
                  className="se-chip-x"
                  disabled={busy}
                  aria-label={`Remove ${d}`}
                  onClick={() => void patch({ dislikes: profile.dislikes.filter((x) => x !== d) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <ChipAdd
          draft={dislikeDraft}
          setDraft={setDislikeDraft}
          busy={busy}
          placeholder='e.g. "cilantro"'
          onAdd={() => {
            const t = dislikeDraft.trim();
            if (!t) return;
            void patch({ dislikes: [...profile.dislikes, t] });
            setDislikeDraft('');
          }}
        />
      </div>
    </>
  );
}

function ChipAdd({
  draft,
  setDraft,
  busy,
  placeholder,
  onAdd,
}: {
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  placeholder: string;
  onAdd: () => void;
}) {
  return (
    <div className="se-add-row">
      <input
        className="wiz-in"
        value={draft}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onAdd();
          }
        }}
      />
      <button className="se-add-btn" disabled={busy || !draft.trim()} onClick={onAdd}>
        Add
      </button>
    </div>
  );
}
