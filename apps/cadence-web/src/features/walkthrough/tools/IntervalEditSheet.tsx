import { useState, type CSSProperties } from 'react';
import {
  EDGE_STEP_SEC,
  INTERVAL_TEMPLATES,
  MAX_EDGE_SEC,
  MAX_RECOVER_SEC,
  MAX_ROUNDS,
  MAX_SETS,
  MAX_WORK_SEC,
  MIN_ROUNDS,
  MIN_WORK_SEC,
  WORK_STEP_SEC,
  addSet,
  applyTemplate,
  clampIntervalPlan,
  expandIntervalPhases,
  intervalShorthand,
  intervalTotalSeconds,
  matchTemplate,
  removeSet,
  updateSet,
  type IntervalPlan,
  type IntervalSet,
} from '@cadence/shared';
import { TONE } from './tone.ts';
import { stripSegments } from './intervalRing.ts';
import { StepperRow } from './IntervalRows.tsx';
import { formatClock } from './timer.ts';
import { grab, sheet } from '../wt-styles.ts';

/**
 * "Edit intervals" (interval design C) — the coach's plan is the **starting point, not the rule**.
 *
 * Four things carry the whole sheet:
 *   • **containment is drawn, not explained.** Work and Recover live inside a set card behind an
 *     amber repeat rail, because those are the two rows the round count multiplies; warm-up,
 *     cool-down and the rest between sets sit outside it, because they run once. Nobody should
 *     have to read a sentence to learn that.
 *   • **templates seed, never lock.** HIIT / EMOM / Tabata are three numbers each, applied to ONE
 *     set; touching any stepper flips that set's chip to Custom and nothing is disabled.
 *   • **a second set is a whole second card**, not a mode — an EMOM finisher after a HIIT block.
 *     A neutral "Rest between sets" row appears with it, because that gap is real time.
 *   • **the strip is the receipt.** One segment per phase, width = seconds — edit a number and
 *     watch the session's shape change. Below it the delta line IS the reset control: a colour
 *     change, never a warning, because changing the plan is allowed.
 */
export function IntervalEditSheet({
  plan,
  coachPlan,
  onSave,
  onClose,
}: {
  plan: IntervalPlan;
  /** What the coach originally prescribed — the thing "tap to reset" restores. */
  coachPlan: IntervalPlan;
  onSave: (plan: IntervalPlan) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<IntervalPlan>(plan);
  // The first set's tooltip restates the maths live, and is the one shown open on arrival — it is
  // the only thing in here someone might genuinely not know.
  const [openTip, setOpenTip] = useState<string | null>('rounds-0');

  const edge = (field: 'warmupSec' | 'cooldownSec' | 'restBetweenSetsSec', delta: number) => () =>
    setDraft((d) => clampIntervalPlan({ ...d, [field]: clamp(d[field] + delta, 0, MAX_EDGE_SEC) }));
  const tip = (id: string) => () => setOpenTip((cur) => (cur === id ? null : id));

  const total = intervalTotalSeconds(draft);
  const matchesCoach =
    intervalShorthand(draft) === intervalShorthand(coachPlan) &&
    draft.warmupSec === coachPlan.warmupSec &&
    draft.cooldownSec === coachPlan.cooldownSec;

  return (
    <>
      <div style={backdrop} onClick={onClose} aria-hidden />
      <div style={surface} role="dialog" aria-label="Edit intervals">
        <div style={{ ...grab, height: 5, marginBottom: 12 }} aria-hidden />
        <div style={heading}>Edit intervals</div>

        <StepperRow
          label="Warm-up"
          kind="neutral"
          value={formatClock(draft.warmupSec)}
          tip="Runs once, before the rounds. Take it to 0:00 to skip — a 5s “get in position” count runs instead."
          tipOpen={openTip === 'warm'}
          onTip={tip('warm')}
          onMinus={edge('warmupSec', -EDGE_STEP_SEC)}
          onPlus={edge('warmupSec', EDGE_STEP_SEC)}
        />

        {draft.sets.map((set, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {/* The gap between two sets is real time, so it gets a real row — auto-inserted with
                the second set rather than hidden inside it. */}
            {i > 0 && (
              <StepperRow
                // "Rest", not "Rest between sets": it is the one label too long for the row, it
                // sits literally between the two set cards, and it is the word the PLAYER uses for
                // this phase — so the short form is also the consistent one.
                label="Rest"
                kind="neutral"
                value={formatClock(draft.restBetweenSetsSec)}
                tip="The breather between one set and the next. It runs once per gap, outside both sets' rounds."
                tipOpen={openTip === 'rest'}
                onTip={tip('rest')}
                onMinus={edge('restBetweenSetsSec', -EDGE_STEP_SEC)}
                onPlus={edge('restBetweenSetsSec', EDGE_STEP_SEC)}
              />
            )}
            <SetCard
              set={set}
              index={i}
              plural={draft.sets.length > 1}
              openTip={openTip}
              onTip={tip}
              onChange={(patch) => setDraft((d) => updateSet(d, i, patch))}
              onTemplate={(id) => setDraft((d) => applyTemplate(d, i, id))}
              onRemove={draft.sets.length > 1 ? () => setDraft((d) => removeSet(d, i)) : undefined}
            />
          </div>
        ))}

        {draft.sets.length < MAX_SETS && (
          <button style={addSetBtn} onClick={() => setDraft(addSet)}>
            ＋ Add set {draft.sets.length + 1}
          </button>
        )}

        <StepperRow
          label="Cool-down"
          kind="neutral"
          value={formatClock(draft.cooldownSec)}
          tip="Runs once, after the last round. 0:00 skips it."
          tipOpen={openTip === 'cool'}
          onTip={tip('cool')}
          onMinus={edge('cooldownSec', -EDGE_STEP_SEC)}
          onPlus={edge('cooldownSec', EDGE_STEP_SEC)}
        />

        <div style={stripCard}>
          <div style={{ display: 'flex', gap: 2, height: 10 }} aria-hidden>
            {stripSegments(expandIntervalPhases(draft)).map((s) => (
              <div key={s.key} style={{ flex: s.flex, borderRadius: 3, background: s.bg, minWidth: 2 }} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <div style={stripLabel}>Total · {formatClock(total)}</div>
            <button
              style={{ ...deltaLine, color: matchesCoach ? 'oklch(45% 0.09 152)' : TONE.off }}
              onClick={() => setDraft(coachPlan)}
              disabled={matchesCoach}
            >
              {matchesCoach
                ? 'Matches the coach’s plan'
                : `Changed from ${intervalShorthand(coachPlan)} · tap to reset`}
            </button>
          </div>
        </div>

        <button style={saveBtn} onClick={() => onSave(draft)}>
          Save · {formatClock(total)} total
        </button>
      </div>
    </>
  );
}

/**
 * One set: its own template chips, a rounds header, and the two rows the rounds multiply bracketed
 * by the amber repeat rail. The card is what makes "these two repeat, those don't" visible without
 * a word of explanation.
 */
function SetCard({
  set,
  index,
  plural,
  openTip,
  onTip,
  onChange,
  onTemplate,
  onRemove,
}: {
  set: IntervalSet;
  index: number;
  /** Only name it "Set 1" once a Set 2 exists — otherwise the label promises a sibling that doesn't. */
  plural: boolean;
  openTip: string | null;
  onTip: (id: string) => () => void;
  onChange: (patch: Partial<IntervalSet>) => void;
  onTemplate: (id: (typeof INTERVAL_TEMPLATES)[number]['id']) => void;
  /** Absent on the only set — deleting it would empty the screen. */
  onRemove?: () => void;
}) {
  const template = matchTemplate(set);
  const scope = plural ? `set ${index + 1}` : '';
  // The "× 3" pill beside it already carries the count, so the header doesn't repeat it — at 390px
  // with a delete control in the row, "Set 1 · 3 rounds" is the string that truncates.
  const rounds = `${set.rounds} round${set.rounds === 1 ? '' : 's'}`;

  return (
    <div style={setCard}>
      <div style={{ display: 'flex', gap: 6 }}>
        {INTERVAL_TEMPLATES.map((t) => (
          <button key={t.id} style={templateChip(template === t.id)} onClick={() => onTemplate(t.id)}>
            {t.label}
          </button>
        ))}
        {/* Not a mode you switch into — it lights up when the numbers match no template. */}
        <div style={{ ...templateChip(template === null), cursor: 'default' }}>Custom</div>
      </div>

      <StepperRow
        bare
        icon
        scope={scope}
        label={plural ? `Set ${index + 1}` : rounds}
        kind="work"
        value={`× ${set.rounds}`}
        tip={roundsTip(set, index, plural)}
        tipOpen={openTip === `rounds-${index}`}
        onTip={onTip(`rounds-${index}`)}
        onMinus={() => onChange({ rounds: clamp(set.rounds - 1, MIN_ROUNDS, MAX_ROUNDS) })}
        onPlus={() => onChange({ rounds: clamp(set.rounds + 1, MIN_ROUNDS, MAX_ROUNDS) })}
        trailing={
          onRemove ? (
            <button style={removeBtn} onClick={onRemove} aria-label={`Remove set ${index + 1}`}>
              −
            </button>
          ) : undefined
        }
      />

      <div style={repeatRail}>
        <StepperRow
          label="Work"
          scope={scope}
          kind="work"
          value={formatClock(set.workSec)}
          tip="The push. Amber on the ring, rising chime when it starts."
          tipOpen={openTip === `work-${index}`}
          onTip={onTip(`work-${index}`)}
          onMinus={() => onChange({ workSec: clamp(set.workSec - WORK_STEP_SEC, MIN_WORK_SEC, MAX_WORK_SEC) })}
          onPlus={() => onChange({ workSec: clamp(set.workSec + WORK_STEP_SEC, MIN_WORK_SEC, MAX_WORK_SEC) })}
        />
        <StepperRow
          label="Recover"
          scope={scope}
          kind="recover"
          value={formatClock(set.recoverSec)}
          tip="The breather. Green on the ring. At 0:00 it’s EMOM-style — rest inside whatever’s left of each minute."
          tipOpen={openTip === `recover-${index}`}
          onTip={onTip(`recover-${index}`)}
          onMinus={() => onChange({ recoverSec: clamp(set.recoverSec - WORK_STEP_SEC, 0, MAX_RECOVER_SEC) })}
          onPlus={() => onChange({ recoverSec: clamp(set.recoverSec + WORK_STEP_SEC, 0, MAX_RECOVER_SEC) })}
        />
      </div>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The maths, restated in the numbers currently on screen — the one explanation worth showing
 *  unprompted, because "round" and "set" are the words the player will use back at you. */
function roundsTip(set: IntervalSet, index: number, plural: boolean): string {
  const one =
    set.recoverSec > 0
      ? `One round = ${formatClock(set.workSec)} work + ${formatClock(set.recoverSec)} recover`
      : `One round = ${formatClock(set.workSec)} work with no recover`;
  const where = plural ? ` in set ${index + 1}` : '';
  return `${one}${where}, done ${set.rounds}× back to back. Warm-up, cool-down and any rest between sets sit outside the rounds.`;
}

const backdrop: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 70,
  background: 'oklch(22% 0.03 262 / 0.42)',
};
const surface: CSSProperties = {
  ...sheet,
  zIndex: 71,
  background: 'oklch(98% 0.008 85)',
  borderRadius: '22px 22px 0 0',
  padding: '12px 20px 26px',
  gap: 13,
  maxHeight: '100%',
  overflowY: 'auto',
};
const heading: CSSProperties = {
  fontFamily: 'var(--display), serif',
  fontWeight: 600,
  fontSize: 19,
  color: TONE.ink,
};
const templateChip = (active: boolean): CSSProperties => ({
  flex: 1,
  textAlign: 'center',
  border: `1.5px solid ${active ? 'oklch(86% 0.04 66)' : 'oklch(90% 0.015 95)'}`,
  borderRadius: 999,
  padding: '7px 0',
  fontSize: 11.5,
  fontWeight: 900,
  color: active ? TONE.chipInk : 'oklch(45% 0.02 150)',
  background: active ? 'oklch(97% 0.02 74)' : 'white',
  cursor: 'pointer',
});
const setCard: CSSProperties = {
  background: 'oklch(98.5% 0.012 74)',
  border: '1.5px solid oklch(88% 0.04 70)',
  borderRadius: 16,
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
};
/** The amber bracket around the two rows the round count multiplies. */
const repeatRail: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderLeft: '3px solid oklch(79% 0.16 70 / 0.4)',
  paddingLeft: 8,
  marginLeft: 5,
};
/** The reference app's red minus, made quiet — destructive, but not shouting about it. */
const removeBtn: CSSProperties = {
  width: 22,
  height: 22,
  flex: 'none',
  borderRadius: '50%',
  border: '1.5px solid oklch(84% 0.05 30)',
  background: 'transparent',
  color: 'oklch(55% 0.13 30)',
  fontSize: 15,
  fontWeight: 900,
  lineHeight: 1,
  padding: 0,
  cursor: 'pointer',
};
const addSetBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  border: '1.5px dashed oklch(86% 0.03 85)',
  borderRadius: 16,
  padding: 11,
  fontSize: 12.5,
  fontWeight: 900,
  color: 'oklch(52% 0.02 120)',
  background: 'transparent',
  cursor: 'pointer',
};
const stripCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  background: 'oklch(97% 0.012 85)',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 14,
  padding: '12px 13px',
};
const stripLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'oklch(52% 0.02 120)',
  whiteSpace: 'nowrap',
};
const deltaLine: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontSize: 11.5,
  fontWeight: 800,
  cursor: 'pointer',
  textAlign: 'right',
};
const saveBtn: CSSProperties = {
  border: 'none',
  borderRadius: 16,
  padding: 15,
  fontSize: 15,
  fontWeight: 900,
  color: 'white',
  cursor: 'pointer',
  background: `linear-gradient(180deg, ${TONE.fillA} 0%, ${TONE.fillB} 46%)`,
  boxShadow: `0 5px 0 ${TONE.deep}`,
};
