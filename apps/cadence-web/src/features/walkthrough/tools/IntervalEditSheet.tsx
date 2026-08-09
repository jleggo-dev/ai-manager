import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  EDGE_STEP_SEC,
  INTERVAL_TEMPLATES,
  MAX_EDGE_SEC,
  MAX_RECOVER_SEC,
  MAX_ROUNDS,
  MAX_WORK_SEC,
  MIN_ROUNDS,
  MIN_WORK_SEC,
  WORK_STEP_SEC,
  applyTemplate,
  clampIntervalPlan,
  expandIntervalPhases,
  intervalShorthand,
  intervalTotalSeconds,
  matchTemplate,
  type IntervalPhaseKind,
  type IntervalPlan,
} from '@cadence/shared';
import { INTERVAL_KIND, TONE } from './tone.ts';
import { stripSegments } from './intervalRing.ts';
import { formatClock } from './timer.ts';
import { grab, sheet } from '../wt-styles.ts';

/**
 * "Edit intervals" (interval design C) — the coach's plan is the **starting point, not the rule**.
 *
 * Three things carry the whole sheet:
 *   • **containment is drawn, not explained.** Work and Recover live inside a set card behind an
 *     amber repeat rail, because those are the two rows the round count multiplies; warm-up and
 *     cool-down sit outside it, because they run once. Nobody should have to read a sentence to
 *     learn that.
 *   • **templates seed, never lock.** HIIT / EMOM / Tabata are three numbers each; touching any
 *     stepper flips the chip to Custom and nothing is disabled. There is no "mode".
 *   • **the strip is the receipt.** One segment per phase, width = seconds — edit a number and
 *     watch the session's shape change. Below it the delta line IS the reset control: a colour
 *     change, never a warning, because changing the plan is allowed.
 *
 * Explanations live behind a 17px `?` disc, one open at a time — rows carry only their name, so
 * the sheet stays scannable for the person who already knows what a Tabata is.
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
  // The set-header tooltip restates the maths live, and is the one shown open on arrival — it is
  // the only thing in here someone might genuinely not know.
  const [openTip, setOpenTip] = useState<string | null>('rounds');

  const adjust = (field: keyof IntervalPlan, delta: number, lo: number, hi: number) => () =>
    setDraft((d) => clampIntervalPlan({ ...d, [field]: Math.min(hi, Math.max(lo, d[field] + delta)) }));
  const tip = (id: string) => () => setOpenTip((cur) => (cur === id ? null : id));

  const template = matchTemplate(draft);
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

        <div style={{ display: 'flex', gap: 6 }}>
          {INTERVAL_TEMPLATES.map((t) => (
            <button
              key={t.id}
              style={templateChip(template === t.id)}
              onClick={() => setDraft((d) => applyTemplate(d, t.id))}
            >
              {t.label}
            </button>
          ))}
          {/* Not a mode you switch into — it lights up when the numbers match no template. */}
          <div style={{ ...templateChip(template === null), cursor: 'default' }}>Custom</div>
        </div>

        <StepperRow
          label="Warm-up"
          kind="neutral"
          value={formatClock(draft.warmupSec)}
          tip="Runs once, before the rounds. Take it to 0:00 to skip — a 5s “get in position” count runs instead."
          tipOpen={openTip === 'warm'}
          onTip={tip('warm')}
          onMinus={adjust('warmupSec', -EDGE_STEP_SEC, 0, MAX_EDGE_SEC)}
          onPlus={adjust('warmupSec', EDGE_STEP_SEC, 0, MAX_EDGE_SEC)}
        />

        <div style={setCard}>
          <StepperRow
            bare
            // The design draws "Set 1 · 6 rounds", which earns its "Set 1" from the "Add set 2"
            // affordance beside it. That second set is not built yet, so naming this one "Set 1"
            // would promise a sibling that doesn't exist — and the two words it costs are exactly
            // the two that make the header wrap at 390px. The ladder still lives in the tooltip.
            label={`${draft.rounds} round${draft.rounds === 1 ? '' : 's'}`}
            kind="work"
            icon
            value={`× ${draft.rounds}`}
            tip={roundsTip(draft)}
            tipOpen={openTip === 'rounds'}
            onTip={tip('rounds')}
            onMinus={adjust('rounds', -1, MIN_ROUNDS, MAX_ROUNDS)}
            onPlus={adjust('rounds', 1, MIN_ROUNDS, MAX_ROUNDS)}
          />
          <div style={repeatRail}>
            <StepperRow
              label="Work"
              kind="work"
              value={formatClock(draft.workSec)}
              tip="The push. Amber on the ring, rising chime when it starts."
              tipOpen={openTip === 'work'}
              onTip={tip('work')}
              onMinus={adjust('workSec', -WORK_STEP_SEC, MIN_WORK_SEC, MAX_WORK_SEC)}
              onPlus={adjust('workSec', WORK_STEP_SEC, MIN_WORK_SEC, MAX_WORK_SEC)}
            />
            <StepperRow
              label="Recover"
              kind="recover"
              value={formatClock(draft.recoverSec)}
              tip="The breather. Green on the ring. At 0:00 it’s EMOM-style — rest inside whatever’s left of each minute."
              tipOpen={openTip === 'recover'}
              onTip={tip('recover')}
              onMinus={adjust('recoverSec', -WORK_STEP_SEC, 0, MAX_RECOVER_SEC)}
              onPlus={adjust('recoverSec', WORK_STEP_SEC, 0, MAX_RECOVER_SEC)}
            />
          </div>
        </div>

        <StepperRow
          label="Cool-down"
          kind="neutral"
          value={formatClock(draft.cooldownSec)}
          tip="Runs once, after the last round. 0:00 skips it."
          tipOpen={openTip === 'cool'}
          onTip={tip('cool')}
          onMinus={adjust('cooldownSec', -EDGE_STEP_SEC, 0, MAX_EDGE_SEC)}
          onPlus={adjust('cooldownSec', EDGE_STEP_SEC, 0, MAX_EDGE_SEC)}
        />

        <div style={stripCard}>
          <div style={{ display: 'flex', gap: 2, height: 10 }} aria-hidden>
            {stripSegments(expandIntervalPhases(draft)).map((s) => (
              <div key={s.key} style={{ flex: s.flex, borderRadius: 3, background: s.bg, minWidth: 2 }} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
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

/** The maths, restated in the numbers currently on screen — the one explanation worth showing
 *  unprompted, because "round" and "set" are the words the player will use back at you. */
function roundsTip(plan: IntervalPlan): string {
  const one =
    plan.recoverSec > 0
      ? `One round = ${formatClock(plan.workSec)} work + ${formatClock(plan.recoverSec)} recover`
      : `One round = ${formatClock(plan.workSec)} work with no recover`;
  return `${one}, done ${plan.rounds}× back to back. Warm-up and cool-down sit outside the rounds.`;
}

/** One row: kind dot + label + `?` + `− pill +`. Every editable number in the sheet is this shape,
 *  so the steppers are learned once. */
function StepperRow({
  label,
  kind,
  value,
  tip,
  tipOpen,
  onTip,
  onMinus,
  onPlus,
  bare,
  icon,
}: {
  label: string;
  kind: IntervalPhaseKind;
  value: string;
  tip: string;
  tipOpen: boolean;
  onTip: () => void;
  onMinus: () => void;
  onPlus: () => void;
  /** The set-card header sits ON the card, so it drops the row's own white surface. */
  bare?: boolean;
  icon?: boolean;
}) {
  const pill = PILL[kind];
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={bare ? bareRow : row}>
        {icon ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={pill.ink}
            strokeWidth={2.4}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M20 12a8 8 0 1 1-2.6-5.9" />
            <path d="M20 4v4h-4" />
          </svg>
        ) : (
          <div style={{ width: 10, height: 10, flex: 'none', borderRadius: '50%', background: pill.dot }} aria-hidden />
        )}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: TONE.ink }}>{label}</div>
          <button style={tipDisc} onClick={onTip} aria-expanded={tipOpen} aria-label={`What is ${label}?`}>
            ?
          </button>
        </div>
        <Stepper sign="−" onClick={onMinus} label={`Less ${label}`} />
        <div style={{ ...valuePill, background: pill.bg, border: `1.5px solid ${pill.border}`, color: pill.ink }}>
          {value}
        </div>
        <Stepper sign="+" onClick={onPlus} label={`More ${label}`} />
      </div>
      {tipOpen && <div style={tipBubble}>{tip}</div>}
    </div>
  );
}

function Stepper({ sign, onClick, label }: { sign: ReactNode; onClick: () => void; label: string }) {
  return (
    <button style={stepperBtn} onClick={onClick} aria-label={label}>
      {sign}
    </button>
  );
}

const PILL: Record<IntervalPhaseKind, { bg: string; border: string; ink: string; dot: string }> = {
  work: {
    bg: 'oklch(97% 0.02 74)',
    border: 'oklch(86% 0.04 66)',
    ink: 'oklch(48% 0.11 60)',
    dot: INTERVAL_KIND.work.done,
  },
  recover: {
    bg: 'oklch(97% 0.015 152)',
    border: 'oklch(85% 0.04 152)',
    ink: 'oklch(42% 0.08 152)',
    dot: INTERVAL_KIND.recover.done,
  },
  neutral: {
    bg: 'oklch(97.5% 0.008 85)',
    border: 'oklch(90% 0.015 85)',
    ink: 'oklch(42% 0.02 150)',
    dot: INTERVAL_KIND.neutral.done,
  },
};

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
const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'white',
  border: '1px solid oklch(91% 0.015 85)',
  borderRadius: 14,
  padding: 12,
};
const bareRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '2px 2px 2px 4px' };
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
const tipDisc: CSSProperties = {
  width: 17,
  height: 17,
  flex: 'none',
  borderRadius: '50%',
  border: '1.5px solid oklch(85% 0.02 85)',
  background: 'transparent',
  color: 'oklch(55% 0.02 120)',
  fontSize: 10,
  fontWeight: 900,
  lineHeight: 1,
  padding: 0,
  cursor: 'pointer',
};
const tipBubble: CSSProperties = {
  alignSelf: 'flex-start',
  margin: '5px 0 2px 20px',
  background: 'oklch(30% 0.02 150)',
  color: 'oklch(96% 0.008 85)',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.45,
  borderRadius: 10,
  padding: '7px 11px',
  maxWidth: 280,
};
const stepperBtn: CSSProperties = {
  width: 38,
  height: 34,
  flex: 'none',
  border: 'none',
  borderRadius: 999,
  background: 'linear-gradient(180deg, #fff 0%, oklch(96% 0.01 85) 46%)',
  boxShadow: '0 3px 0 oklch(88% 0.02 85), 0 0 0 1px oklch(92% 0.015 85)',
  fontSize: 18,
  fontWeight: 800,
  color: 'oklch(40% 0.02 150)',
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
};
const valuePill: CSSProperties = {
  minWidth: 58,
  textAlign: 'center',
  borderRadius: 999,
  padding: '6px 10px',
  fontSize: 13.5,
  fontWeight: 900,
  fontVariantNumeric: 'tabular-nums',
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
