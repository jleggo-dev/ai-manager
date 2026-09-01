import { useState } from 'react';
import {
  type CircuitExercise,
  type OccurrenceSession,
  type SessionBlock,
  type SessionItem,
  type StepTool,
  type WalkthroughStep,
} from '@cadence/shared';
import { createUserRoutine, type UserRoutineProvenance } from '../../lib/api.ts';
import { TONE } from './tools/tone.ts';
import { recapCard, sectionLabel, outlineBtn, greenBtn } from './wt-styles.ts';

/**
 * Recap E/F — "Save this as one of yours" (Activity Builder wave 3, W3-3). Hevy's cheapest
 * builder entry: the walkthrough already ran, so the session that just played is the honest
 * starting point for a routine.
 *
 * What Recap actually holds: `Recap.tsx` never received the coach's original `OccurrenceSession`
 * — only the flat `WalkthroughStep[]` the player rendered (see `Walkthrough.tsx`'s own props,
 * which stop at the already-derived `WalkthroughData` + `title`). So this file reverses the ONE
 * projection that produced those steps (`deriveWalkthrough`, packages/cadence-shared/src/
 * walkthrough.ts) back into blocks/items, rather than saving an invented session. The reverse map
 * is not lossy for anything that changes how a step PLAYS — every number the player used is right
 * there on the step (a timer's seconds, an interval's plan, a circuit's rounds and exercises). The
 * only things that can't round-trip are choices the forward projection itself never keeps either:
 * a grounding letter BANK (only the resolved spec's `game` survives on the step — an unrecognised
 * bank already degrades to the default the same honest way) and a photo step's `purpose`
 * (`deriveWalkthrough` hard-codes `'progress'` regardless of what the coach originally meant, so
 * there was never a real value here to lose). A journal step with no NAMED bank keeps its literal
 * prompt; one WITH a bank leaves `detail` unset on purpose, so it keeps rotating the bank's daily
 * phrasing next time instead of freezing on today's.
 */

const PROVENANCE: UserRoutineProvenance = { kind: 'from_recap' };

function circuitToBlock(step: WalkthroughStep, tool: Extract<StepTool, { kind: 'circuit' }>): SessionBlock {
  const items: SessionItem[] = tool.exercises.map((e: CircuitExercise) => ({
    name: e.name,
    ...(e.reps != null ? { reps: e.reps } : {}),
    ...(e.load ? { load: e.load } : {}),
    ...(e.seconds != null ? { duration_min: e.seconds / 60 } : {}),
    ...(e.detail ? { detail: e.detail } : {}),
    ...(e.video_query ? { video_query: e.video_query } : {}),
  }));
  return { label: step.group ?? step.title, items, mode: 'circuit', rounds: tool.rounds };
}

/** Distance-only checkoff labels are built as `` `${km} km` `` (walkthrough.ts) — recovered the
 *  same literal way rather than guessed at; anything else stays a plain cue in `detail`. */
function checkoffFields(label: string | undefined): Partial<SessionItem> {
  if (!label) return {};
  const km = /^([\d.]+)\s*km$/.exec(label);
  return km ? { distance_km: Number(km[1]) } : { detail: label };
}

/** One played step back to the prescribed item it came from. `item.tool` is set explicitly for
 *  every kind that has one, so replaying through `inferTool` takes the first, unambiguous branch
 *  rather than re-guessing from quantities. */
function stepToItem(step: WalkthroughStep): SessionItem {
  const item: SessionItem = { name: step.title, duration_min: step.minutes };
  if (step.body) item.detail = step.body;
  if (step.video_query) item.video_query = step.video_query;
  if (step.metronome) {
    item.metronome_bpm = step.metronome.bpm;
    item.metronome_meter = step.metronome.meter;
  }

  const t = step.tool;
  switch (t.kind) {
    case 'read':
      item.tool = 'read';
      break;
    case 'timer':
      item.tool = 'timer';
      item.duration_min = t.seconds / 60;
      break;
    case 'reps':
      item.tool = 'reps';
      item.sets = t.sets;
      if (t.reps != null) item.reps = t.reps;
      if (t.load) item.load = t.load;
      break;
    case 'checkoff':
      item.tool = 'checkoff';
      Object.assign(item, checkoffFields(t.label));
      break;
    case 'breathing':
      item.tool = 'breathing';
      item.breath_pattern = t.pattern.id;
      item.breath_cycles = t.cycles;
      break;
    case 'meditate':
      item.tool = 'meditate';
      item.duration_min = t.seconds / 60;
      item.meditate_bells = t.bells;
      item.meditate_interval_min = t.intervalMin;
      break;
    case 'grounding':
      item.tool = 'grounding';
      item.grounding_game = t.spec.game;
      break;
    case 'feeling_log':
      item.tool = 'feeling_log';
      break;
    case 'photo':
      item.tool = 'photo';
      item.detail = t.prompt;
      break;
    case 'journal':
      item.tool = 'journal';
      if (t.bank) item.journal_bank = t.bank;
      else item.detail = t.prompt; // no named bank → the prompt itself IS the honest source
      if (t.minutes) item.duration_min = t.minutes;
      break;
    case 'interval': {
      item.tool = 'interval';
      const plan = t.plan;
      item.interval_warmup_sec = plan.warmupSec;
      item.interval_cooldown_sec = plan.cooldownSec;
      const first = plan.sets[0];
      if (first) {
        item.interval_work_sec = first.workSec;
        item.interval_recover_sec = first.recoverSec;
        item.interval_rounds = first.rounds;
      }
      break;
    }
    case 'measure':
      // Deliberately NOT `item.tool = 'measure'` — that value doesn't exist on
      // `SessionItemTool` (measure is only ever reached by inference from these two fields).
      item.measure_metric = t.metric;
      item.measure_unit = t.unit;
      break;
    // `circuit` is handled a level up, in `sessionFromSteps` — a circuit step becomes a WHOLE
    // block, not one item, so `stepToItem` never actually sees one in practice. `rings`/`insight`
    // are app-inserted insight surfaces `deriveWalkthrough` has no branch that produces from a
    // `SessionItem`, so a real played step can't carry one either. All three are kept here only so
    // this switch stays exhaustive rather than silently dropping a future tool kind.
    case 'circuit':
    case 'rings':
    case 'insight':
      item.tool = 'checkoff';
      break;
    default: {
      const _exhaustive: never = t;
      void _exhaustive;
    }
  }
  return item;
}

/** The closest honest `OccurrenceSession` to what actually played — reversing the one projection
 *  Recap's `steps` came through, never inventing anything past what the walkthrough itself ran. */
function sessionFromSteps(steps: WalkthroughStep[]): OccurrenceSession {
  const blocks: SessionBlock[] = [];
  let current: { label: string; items: SessionItem[] } | null = null;
  const flush = () => {
    if (current && current.items.length > 0) blocks.push({ label: current.label, items: current.items });
    current = null;
  };
  for (const step of steps) {
    if (step.tool.kind === 'circuit') {
      flush();
      blocks.push(circuitToBlock(step, step.tool));
      continue;
    }
    const label = step.group ?? '';
    if (!current || current.label !== label) {
      flush();
      current = { label, items: [] };
    }
    current.items.push(stepToItem(step));
  }
  flush();
  return { blocks, note: '', generated_at: new Date().toISOString(), version: 1 };
}

type SaveState = 'idle' | 'open' | 'saving' | 'saved' | 'failed';

/** The quiet line itself. `steps` is the FULL configured walkthrough (not filtered to what was
 *  actually done) — "save this as one of yours" saves the session as configured/played, the same
 *  thing `Run it now` would replay, not a partial receipt of one particular run. */
export function SaveAsYours({ steps, title }: { steps: WalkthroughStep[]; title: string }) {
  const [state, setState] = useState<SaveState>('idle');
  const [name, setName] = useState(title);

  if (steps.length === 0) return null;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState('saving');
    const saved = await createUserRoutine({
      name: trimmed,
      session: sessionFromSteps(steps),
      provenance: PROVENANCE,
    });
    setState(saved ? 'saved' : 'failed');
  }

  if (state === 'saved') {
    return (
      <div style={{ ...recapCard, marginTop: 10 }}>
        <div style={sectionLabel}>Saved</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: TONE.ink2 }}>{"It's in Your activities."}</div>
      </div>
    );
  }

  if (state === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setState('open')}
        style={{ ...outlineBtn, textAlign: 'left', padding: '13px 14px' }}
      >
        Save this as one of yours
      </button>
    );
  }

  return (
    <div style={{ ...recapCard, marginTop: 10, gap: 8 }}>
      <div style={sectionLabel}>Save this as one of yours</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Name this activity"
        disabled={state === 'saving'}
        style={{ border: '1.5px solid oklch(86% 0.03 85)', borderRadius: 10, padding: '9px 11px', fontSize: 14 }}
      />
      {state === 'failed' && (
        <div style={{ fontSize: 12, color: 'oklch(50% 0.02 150)' }}>
          {"That didn't go through — try again in a moment."}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={{ ...greenBtn, flex: 1, padding: 12 }}
          disabled={state === 'saving' || !name.trim()}
          onClick={() => void save()}
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          style={{ ...outlineBtn, flex: 'none', padding: '12px 16px' }}
          disabled={state === 'saving'}
          onClick={() => {
            setState('idle');
            setName(title);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
