import { useEffect, useState } from 'react';
import {
  createUserRoutine,
  updateUserRoutine,
  type UserRoutine,
  type UserRoutineProvenance,
} from '../../lib/api/user-routines.ts';
import type { OccurrenceSession, SessionItem } from '@cadence/shared';
import { clearDraft, writeDraft, type BuilderDraft } from './draftStore.ts';
import { describeDraft } from './draftMessage.ts';
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
  onAskReview,
  restore,
  onMinimize,
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
  /** "Ask the coach" — hands the ask, in the user's own visible words, to whatever steer bridge the
   *  host wires. The door hides itself without one. From the SAVE MOMENT the name is the whole
   *  payload (the routine is on the server, so her context pack carries its steps); from a DRAFT
   *  the steps travel in the message, because a draft is on nobody's server (draftMessage.ts). */
  onAskReview?: (text: string) => void;
  /**
   * A draft this device was already holding (draftStore.ts), seeded straight into the state below.
   * Set by the host when the pill reopens a minimized builder, or on a launch that found one left
   * over from before a force-quit. It wins over `initial`: it IS the later version of it.
   */
  restore?: BuilderDraft;
  /**
   * Step aside without deciding anything — the owner's third door (2026-09-06), and the one a nav
   * tap now takes by itself. The draft is held on disk either way, so the host is free to simply
   * hide this screen and offer it back; nothing here needs to ask a question first.
   */
  onMinimize?: () => void;
}) {
  const isUpdate = !!(updateRoutineId ?? restore?.updateRoutineId);
  // A restored draft IS something to edit, so it satisfies the same requirement `initial.session`
  // does — the assertion is about having content, not about which door delivered it.
  if (import.meta.env.DEV && isUpdate && !initial?.session && !restore) {
    throw new Error('ActivityBuilder: updateRoutineId requires initial.session — nothing to edit without one.');
  }
  const [phase, setPhase] = useState<'type' | 'builder' | 'saved'>(
    restore?.phase ?? (initial?.session || isUpdate ? 'builder' : 'type'),
  );
  const [family, setFamily] = useState<BuilderFamily | null>(restore?.family ?? null);
  const [cards, setCards] = useState<BuilderCard[]>(() => restore?.cards ?? cardsFromSession(initial?.session));
  const [name, setName] = useState(restore?.name ?? initial?.name ?? '');
  const [area, setArea] = useState<UserRoutine['area'] | undefined>(restore?.area ?? initial?.area);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRoutine, setSavedRoutine] = useState<UserRoutine | null>(null);

  /**
   * Hold the draft on every change, so minimizing it is lossless without anyone deciding to save.
   *
   * This is what lets a nav tap ask nothing at all: the promise the pill makes ("it's still
   * there") is kept by disk, not by the component staying mounted, so it survives a force-quit
   * and iOS reclaiming the webview. `writeDraft` drops an empty draft rather than storing it, so
   * opening the builder, looking at it and tapping away leaves nothing behind.
   *
   * Only while there is a draft to hold: the saved phase has already handed its routine over, and
   * re-persisting it there would put a finished activity back in the pill.
   */
  useEffect(() => {
    if (phase === 'saved') return;
    writeDraft({ phase, family, cards, name, area, updateRoutineId });
  }, [phase, family, cards, name, area, updateRoutineId]);

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

  /**
   * Throw the draft away, on purpose and at once.
   *
   * There is no "are you sure?" here by owner ruling (2026-09-06), and the reason it is safe to
   * drop is that navigation no longer destroys anything: the way to leave without deciding is to
   * tap a tab, which minimizes. That leaves Discard as the one deliberate destructive act on the
   * screen, under a button that says exactly what it does.
   */
  function discard() {
    clearDraft();
    onClose();
  }

  /** "Ask the coach" from inside a draft — the steps travel with it (draftMessage.ts), and the
   *  builder steps aside rather than closing, so the draft is still there to apply her answer to. */
  const draftAsk = onAskReview && phase === 'builder' ? describeDraft(name, cards) : null;

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
    clearDraft(); // it is a routine now, not unfinished business the pill should keep offering
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
        onClose={discard}
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
        onAskReview={onAskReview && (() => onAskReview(`Can you look over my activity "${savedRoutine.name}"?`))}
      />
    );
  }

  const dotColor = family ? familyOf(family).color : 'oklch(68% 0.015 150)';

  return (
    <div className="ab" role="region" aria-label="Build your own activity">
      {/* Three doors, and the fourth is the tab bar: minimize is what a nav tap does by itself, so
          it needs no button here (owner, 2026-09-06). Ask the coach sits in the middle because it is
          the one that keeps the draft — Discard and Save both end it. */}
      <div className="ab-bhead">
        <button type="button" className="ab-discard" onClick={discard}>
          Discard
        </button>
        {draftAsk && (
          <button
            type="button"
            className="ab-ask"
            onClick={() => {
              onMinimize?.();
              onAskReview?.(draftAsk);
            }}
          >
            Ask the coach
          </button>
        )}
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
    </div>
  );
}
