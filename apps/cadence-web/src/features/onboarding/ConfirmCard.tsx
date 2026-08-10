import { useEffect, useState, type ReactNode } from 'react';
import type { Baseline, Goal } from '@cadence/shared';
import { getReview, type ReviewData } from '../../lib/api.ts';
import { TIME_OF_DAY_LABELS } from '../review/reviewConstants.ts';
import { cmToFtIn, kgToLbs } from '../review/unitConversion.ts';

/**
 * "Here's everything I've heard." The confirmation turn, rendered inside the chat.
 *
 * The coach asks for this (a `confirm` pick block) rather than the client deciding intake is
 * over — she is the one who knows whether she has enough. What she does NOT do is recite the
 * captures in prose: a model retelling the user's own data is a model that can quietly get one
 * wrong, so the app renders the stored rows and every correction goes to the store.
 *
 * Long sections collapse to a one-line summary. A confirmation that takes four screens of
 * scrolling gets skimmed and waved through, which is the opposite of what confirming is for.
 *
 * **Corrections happen in the conversation.** "fix" used to open the pre-v2 curate wizard, which
 * threw someone out of the chat at the exact moment they were being asked to confirm it — and
 * confirming is the one turn where leaving the conversation costs the most. A tap now drafts the
 * correction into the composer, the same contract as a quick pick and as the capture pills: read
 * it back, edit it, send it. Cadence can just be told. The wizard still exists for Settings, where
 * editing a committed plan IS the task.
 */

/** Sections beyond this many rows arrive folded; the summary says what's inside. */
const FOLD_OVER = 3;

function Section({
  title,
  summary,
  rows,
  onCorrect,
}: {
  title: string;
  summary: string;
  rows: ReactNode[];
  onCorrect?: () => void;
}) {
  const foldable = rows.length > FOLD_OVER;
  const [open, setOpen] = useState(!foldable);
  if (!rows.length) return null;
  return (
    <div className="cfm-sec">
      <div className="cfm-head">
        <button
          type="button"
          className="cfm-k"
          onClick={() => foldable && setOpen((o) => !o)}
          aria-expanded={foldable ? open : undefined}
          disabled={!foldable}
        >
          {title}
          {foldable && <span aria-hidden>{open ? ' ▾' : ' ▸'}</span>}
        </button>
        {onCorrect && (
          <button type="button" className="cfm-edit" onClick={onCorrect}>
            fix
          </button>
        )}
      </div>
      {open ? <div className="cfm-rows">{rows}</div> : <div className="cfm-sum">{summary}</div>}
    </div>
  );
}

function goalWhen(g: Goal): string {
  const end = g.timeframe?.end;
  if (end)
    return `· by ${new Date(`${end}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`;
  return g.type === 'recurring' ? '· ongoing' : '';
}

/** The ↳ line: stepping-stones, and who programs the sessions. Only what was actually captured. */
function goalUnder(g: Goal): string {
  const parts = (g.milestones ?? []).map((m) => m.label);
  if (g.plan_mode === 'deterministic') parts.push('a progression engine programs each session');
  else if (g.plan_mode === 'coach') parts.push('I program each session');
  return parts.join(' · ');
}

function aboutYouLine(name: string, b: Baseline): string {
  const bits: string[] = [];
  if (name.trim()) bits.push(name.trim());
  if (b.age) bits.push(String(b.age));
  if (b.height_cm) {
    const { ft, in: inches } = cmToFtIn(b.height_cm);
    bits.push(b.height_unit === 'cm' ? `${Math.round(b.height_cm)} cm` : `${ft}′${inches}″`);
  }
  const kg = b.weight_kg?.current;
  if (kg) bits.push(b.weight_unit === 'kg' ? `${kg} kg` : `${Math.round(kgToLbs(kg))} lbs`);
  return bits.join(' · ');
}

/** The second line: when they can do it, and how often. Empty until they've said. */
function availabilityLine(b: Baseline): string {
  const bits: string[] = [];
  if (b.time_of_day) bits.push(TIME_OF_DAY_LABELS[b.time_of_day]);
  if (b.days_per_week) bits.push(`${b.days_per_week} ${b.days_per_week === 1 ? 'day' : 'days'} a week`);
  return bits.join(' · ');
}

export function ConfirmCard({
  onCorrect,
  onTellMore,
}: {
  /** Draft a correction about `topic` into the composer — never a wizard. */
  onCorrect: (topic: string) => void;
  onTellMore: () => void;
}) {
  const [data, setData] = useState<ReviewData | null>(null);

  useEffect(() => {
    getReview()
      .then(setData)
      .catch(() => {
        /* the coach's prose still stands; the cards just don't paint */
      });
  }, []);

  if (!data) return null;
  const baseline: Baseline = {
    ...data.baseline,
    constraints: data.baseline?.constraints ?? [],
    preferences: data.baseline?.preferences ?? {},
  };
  const about = aboutYouLine(data.name, baseline);
  const avail = availabilityLine(baseline);
  const milestones = data.goals.reduce((n, g) => n + (g.milestones?.length ?? 0), 0);

  return (
    <div className="cfm">
      <Section
        title="Goals"
        summary={`${data.goals.length} goals${milestones ? ` · ${milestones} milestones` : ''}`}
        onCorrect={() => onCorrect('my goals')}
        rows={data.goals.map((g) => (
          <div key={g.goal_id} className="cfm-goal">
            <div className="cfm-goal-t">
              <span className={`qp-dot is-${g.area}`} aria-hidden />
              <b>{g.title}</b>
              <span>{goalWhen(g)}</span>
            </div>
            {goalUnder(g) && <div className="cfm-goal-u">↳ {goalUnder(g)}</div>}
          </div>
        ))}
      />
      <Section
        title="About you"
        summary={about}
        onCorrect={() => onCorrect('my details')}
        rows={[
          about ? <div key="about">{about}</div> : null,
          avail ? (
            <div key="avail" className="cfm-mute">
              {avail}
            </div>
          ) : null,
        ].filter(Boolean)}
      />
      <Section
        title="What we work around"
        summary={`${baseline.constraints.length} things`}
        onCorrect={() => onCorrect('what we work around')}
        rows={baseline.constraints.map((c) => (
          <div key={c.id}>
            {c.label}
            {c.plan_around && <span className="cfm-mute"> — we plan around it</span>}
          </div>
        ))}
      />
      <Section
        title="Tools"
        summary={`${data.equipment.length} things`}
        onCorrect={() => onCorrect('what I have to work with')}
        rows={data.equipment.length ? [<div key="gear">{data.equipment.map((e) => e.name).join(' · ')}</div>] : []}
      />
      <button type="button" className="cfm-more" onClick={onTellMore}>
        + Did I miss something? Tell me
      </button>
    </div>
  );
}
