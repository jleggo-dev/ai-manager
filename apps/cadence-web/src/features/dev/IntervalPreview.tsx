import { useState } from 'react';
import {
  INTERVAL_TEMPLATES,
  clampIntervalPlan,
  intervalShorthand,
  intervalTotalMinutes,
  type IntervalPlan,
  type WalkthroughStep,
} from '@cadence/shared';
import { StepInterval, type StepChrome } from '../walkthrough/tools/StepInterval.tsx';
import type { StepLog } from '../walkthrough/state.ts';

type IntervalLog = Extract<StepLog, { kind: 'interval' }>;

/** Short enough that a whole run finishes inside a dev loop — the completion state, the done
 *  chime and the auto-advance are the things you actually need to watch. */
const QUICK: IntervalPlan = clampIntervalPlan({ warmupSec: 0, workSec: 5, recoverSec: 5, rounds: 3, cooldownSec: 0 });

const step = (title: string): WalkthroughStep => ({
  id: 'preview',
  title,
  minutes: 1,
  tool: { kind: 'read' },
  skippable: true,
});

/**
 * A dev harness for the interval player, at `?preview=interval` with no API, no auth and no plan.
 *
 * It exists for the same reason the breath pacer's does: this tool's correctness is **temporal and
 * chromatic** — phase hand-over, the frame colour crossfade, the direction of each chime, the ring
 * refilling wedge by wedge — and none of that can be judged from a screenshot or a unit test.
 * Waiting on a coach-composed session to watch a 9-minute HIIT run is a very slow loop, so the
 * quick preset runs three 5/5 rounds instead.
 *
 * The frame tint is applied here too, so the whole-screen colour swap is visible without the
 * walkthrough shell around it.
 */
export function IntervalPreview() {
  const [plan, setPlan] = useState<IntervalPlan>(QUICK);
  const [last, setLast] = useState<IntervalLog | null>(null);
  const [chrome, setChrome] = useState<StepChrome | null>(null);
  const [runKey, setRunKey] = useState(0);

  const choose = (next: IntervalPlan) => {
    setPlan(next);
    setLast(null);
    setRunKey((k) => k + 1);
  };

  return (
    <div
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        minHeight: '100%',
        boxSizing: 'border-box',
        background: chrome?.tint ?? 'oklch(96% 0.015 95)',
        transition: 'background 0.7s ease',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.55 }}>
        Intervals · dev preview
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip label="Quick 3 × 5/5" active={plan === QUICK} onClick={() => choose(QUICK)} />
        {INTERVAL_TEMPLATES.map((t) => (
          <Chip
            key={t.id}
            label={t.label}
            active={plan.workSec === t.workSec && plan.recoverSec === t.recoverSec && plan.rounds === t.rounds}
            onClick={() =>
              choose(clampIntervalPlan({ workSec: t.workSec, recoverSec: t.recoverSec, rounds: t.rounds }))
            }
          />
        ))}
        <Chip
          label="With warm-up + cool-down"
          active={plan.warmupSec > 0}
          onClick={() => choose(clampIntervalPlan({ ...plan, warmupSec: 20, cooldownSec: 15 }))}
        />
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 800, opacity: 0.7 }}>
        {intervalShorthand(plan)} · {intervalTotalMinutes(plan)} min · warm-up {plan.warmupSec}s · cool-down{' '}
        {plan.cooldownSec}s
      </div>

      <StepInterval
        key={runKey}
        step={step('Bike sprints')}
        plan={plan}
        onLog={setLast}
        onDone={() => undefined}
        onChrome={setChrome}
      />

      <div style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.7 }}>
        {last
          ? `logged → ${last.roundsDone} of ${last.totalRounds} rounds · ${last.elapsedSec}/${last.targetSec}s (${last.shorthand})`
          : 'no log yet'}
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: active ? '1.5px solid oklch(76% 0.15 55)' : '1.5px solid oklch(90% 0.015 95)',
        background: active ? 'oklch(95% 0.05 68)' : 'white',
        borderRadius: 999,
        padding: '7px 11px',
        fontSize: 11.5,
        fontWeight: 800,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
