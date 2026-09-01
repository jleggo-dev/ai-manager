import { useState } from 'react';
import {
  createUserRoutine,
  updateUserRoutine,
  type UserRoutine,
  type UserRoutineProvenance,
} from '../../lib/api/user-routines.ts';
import type { OccurrenceSession, SessionItem } from '@cadence/shared';
import {
  addCircuitExercise,
  addStepOfKind,
  cardsFromSession,
  deleteCard,
  duplicateCard,
  formatStepSummary,
  moveCardDown,
  moveCardUp,
  removeCircuitExercise,
  retitleCard,
  sessionFromCards,
  updateCardItem,
  updateCircuitExercise,
  updateCircuitRounds,
  type BuilderCard,
} from './builderSession.ts';
import { familyOf, type BuilderFamily, type BuilderSeed } from './builderSeeds.ts';
import { TypeFirstEntry } from './TypeFirstEntry.tsx';
import { StepCard } from './StepCard.tsx';
import { StepPalette } from './StepPalette.tsx';
import { SavedMoment } from './SavedMoment.tsx';

/**
 * The Activity Builder (parcel W3-2) — the full-screen surface where a person assembles their own
 * activity from the coach's own step tools. TURN 1's three laws in one component: **one palette**
 * (the tool catalog is the same one the coach builds from — `StepPalette.tsx`), **seed, never
 * lock** (every number a starting point ships with stays a plain-input edit — `StepCard.tsx` /
 * `StepCardFields.tsx`), **the coach reviews, never rewrites** (saving here is wholly
 * deterministic — `createUserRoutine`, no generation anywhere in this file).
 *
 * Phases: `type` (design B — shown only when there's no session yet) → `builder` (design 1B — the
 * step-card stack) → `saved` (design E, trimmed). Editing an existing routine, or a from-Cadence /
 * from-Recap copy, skips straight to `builder` via `initial.session`.
 *
 * **Update mode** (`updateRoutineId`, added post-merge for Settings' "Edit steps" door — a gap in
 * the original brief: the builder only knew how to create, so wiring it as-is would have silently
 * duplicated instead of updating). When set, this is the SAME surface editing an EXISTING routine
 * in place: type-first never shows (there is nothing to pick a family for), Save calls
 * `updateUserRoutine` instead of `createUserRoutine`, and the save moment's copy says so. The
 * contract's patch shape carries no `provenance` — it is fixed at creation — so update never sends
 * one, matching `updateUserRoutine`'s own signature.
 */
export function ActivityBuilder({
  initial,
  updateRoutineId,
  onSaved,
  onClose,
}: {
  initial?: {
    name?: string;
    session?: OccurrenceSession;
    provenance?: UserRoutineProvenance;
    /**
     * Not in the wave-3 contract's own `UserRoutine` shape, added here as an optional pass-through
     * so a from-Cadence/from-Recap host can carry the source routine's area straight in — see the
     * ActivityBuilder report's "deviations" note. Type-first entry (which derives area from the
     * family picked) is skipped whenever `initial.session` is set, so this is the only other route
     * area can take.
     */
    area?: UserRoutine['area'];
  };
  /** Present = editing this routine in place rather than building a new one. Requires
   *  `initial.session` (asserted in dev — there's nothing to edit without one). */
  updateRoutineId?: string;
  onSaved: (routine: UserRoutine) => void;
  onClose: () => void;
}) {
  const isUpdate = !!updateRoutineId;
  if (import.meta.env.DEV && isUpdate && !initial?.session) {
    throw new Error('ActivityBuilder: updateRoutineId requires initial.session — nothing to edit without one.');
  }
  const [phase, setPhase] = useState<'type' | 'builder' | 'saved'>(initial?.session || isUpdate ? 'builder' : 'type');
  const [family, setFamily] = useState<BuilderFamily | null>(null);
  const [cards, setCards] = useState<BuilderCard[]>(() => cardsFromSession(initial?.session));
  const [name, setName] = useState(initial?.name ?? '');
  const [area, setArea] = useState<UserRoutine['area'] | undefined>(initial?.area);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRoutine, setSavedRoutine] = useState<UserRoutine | null>(null);

  const initialName = (initial?.name ?? '').trim();
  const hasEdits = cards.length > 0 || name.trim() !== initialName;

  function pickSeed(seed: BuilderSeed) {
    setCards(cardsFromSession(seed.session));
    setName(seed.title);
    setArea(familyOf(seed.family).area);
    setPhase('builder');
  }

  function pickBlank() {
    setCards([]);
    setName('');
    setArea(undefined);
    setPhase('builder');
  }

  function requestClose() {
    if (hasEdits) setConfirmClose(true);
    else onClose();
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const session = sessionFromCards(cards);
    const trimmedName = name.trim() || 'Untitled activity';
    // Update never sends `provenance` — the contract's patch shape has none; it's fixed at
    // creation and this call can't change it.
    const result = updateRoutineId
      ? await updateUserRoutine(updateRoutineId, { name: trimmedName, session })
      : await createUserRoutine({
          name: trimmedName,
          area,
          session,
          provenance: initial?.provenance ?? { kind: 'blank' },
        });
    setSaving(false);
    if (!result) {
      setSaveError('Couldn’t save — try again. Your steps are still here.');
      return;
    }
    setSavedRoutine(result);
    setPhase('saved');
  }

  if (phase === 'type' && !isUpdate) {
    return (
      <TypeFirstEntry
        family={family}
        onPickFamily={setFamily}
        onPickSeed={pickSeed}
        onBlank={pickBlank}
        onBackToFamilies={() => setFamily(null)}
        onClose={onClose}
      />
    );
  }

  if (phase === 'saved' && savedRoutine) {
    return (
      <SavedMoment
        name={savedRoutine.name}
        isUpdate={isUpdate}
        onRunNow={() => onSaved(savedRoutine)}
        onDone={() => onSaved(savedRoutine)}
      />
    );
  }

  const dotColor = family ? familyOf(family).color : 'oklch(68% 0.015 150)';

  return (
    <div className="ab" role="region" aria-label="Build your own activity">
      <div className="ab-bhead">
        <button type="button" className="ab-cancel" onClick={requestClose}>
          Cancel
        </button>
        <button type="button" className="ab-save" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : isUpdate ? 'Save changes' : 'Save'}
        </button>
      </div>
      <div className="ab-body">
        <div className="ab-name-row">
          <span className="ab-dot ab-dot-lg" style={{ background: dotColor }} aria-hidden />
          <input
            className="ab-name"
            type="text"
            aria-label="Activity name"
            placeholder="Name it"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {saveError && <div className="ab-save-error">{saveError}</div>}
        <div className="ab-cards">
          {cards.map((card, i) => (
            <StepCard
              key={card.id}
              card={card}
              index={i}
              count={cards.length}
              onRename={(n) => setCards((cs) => retitleCard(cs, i, n))}
              onPatchItem={(patch: Partial<SessionItem>) => setCards((cs) => updateCardItem(cs, i, patch))}
              onCircuitRounds={(rounds) => setCards((cs) => updateCircuitRounds(cs, i, rounds))}
              onCircuitExercise={(exIndex, patch) => setCards((cs) => updateCircuitExercise(cs, i, exIndex, patch))}
              onCircuitAdd={() => setCards((cs) => addCircuitExercise(cs, i))}
              onCircuitRemove={(exIndex) => setCards((cs) => removeCircuitExercise(cs, i, exIndex))}
              onDuplicate={() => setCards((cs) => duplicateCard(cs, i))}
              onDelete={() => setCards((cs) => deleteCard(cs, i))}
              onMoveUp={() => setCards((cs) => moveCardUp(cs, i))}
              onMoveDown={() => setCards((cs) => moveCardDown(cs, i))}
            />
          ))}
        </div>
        <button type="button" className="ab-add-step" onClick={() => setPaletteOpen(true)}>
          ＋ Add step
        </button>
        <div className="ab-footer">{formatStepSummary(cards)}</div>
      </div>
      {paletteOpen && (
        <StepPalette
          onPick={(kind) => {
            setCards((cs) => addStepOfKind(cs, kind));
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {confirmClose && (
        <div className="ab-confirm-wrap" role="dialog" aria-modal="true" aria-label="Discard this draft?">
          <div className="ab-confirm">
            <div className="ab-confirm-t">Discard this draft?</div>
            <div className="ab-confirm-sub">Your steps won’t be saved.</div>
            <div className="ab-confirm-row">
              <button type="button" onClick={() => setConfirmClose(false)}>
                Keep editing
              </button>
              <button
                type="button"
                className="ab-confirm-danger"
                onClick={() => {
                  setConfirmClose(false);
                  onClose();
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
