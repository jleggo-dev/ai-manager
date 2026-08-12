import { useEffect, useState, type ReactNode } from 'react';
import type { AvailabilityWindow, Baseline, Constraint, Goal } from '@cadence/shared';
import { getReview, type ReviewData } from '../../lib/api.ts';
import { TIME_OF_DAY_LABELS, TIME_OF_DAY_SHORT } from '../review/reviewConstants.ts';
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
 *
 * **The build button lives HERE, on the card, not in a bar that replaces the composer.** That bar
 * was the whole card's failure mode: it could only exist once, at the end of onboarding, and while
 * it was up there was no way to type. So a coach who had already spent it had nowhere left to
 * offer a rebuild, and fell back to naming a review screen that no longer exists. On the card, the
 * button is just what this tool does — and the tool can be handed over as many times as a plan
 * needs building.
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

/** "evenings from 19:00" — the clock edge is shown because it is the part someone spots is wrong. */
function windowLabel(w: AvailabilityWindow): string {
  const clock = [w.earliest ? `from ${w.earliest}` : '', w.latest ? `until ${w.latest}` : ''].filter(Boolean).join(' ');
  return clock ? `${TIME_OF_DAY_SHORT[w.part_of_day]} ${clock}` : TIME_OF_DAY_SHORT[w.part_of_day];
}

/**
 * The second line: when they can do it, and for how long. Empty until they've said.
 *
 * Windows win over the older single `time_of_day` when both exist — "early morning and after
 * seven" is the answer they actually gave, and "Any time works" is what it used to be flattened
 * into on the way to a plan scheduled at noon.
 */
function availabilityLine(b: Baseline): string {
  const bits: string[] = [];
  const windows = b.availability?.windows ?? [];
  if (windows.length) {
    const joined = windows.map(windowLabel).join(' · ');
    bits.push(joined.charAt(0).toUpperCase() + joined.slice(1));
  } else if (b.time_of_day) bits.push(TIME_OF_DAY_LABELS[b.time_of_day]);
  const s = b.availability?.session_minutes;
  if (s) bits.push(s.max && s.max > s.min ? `${s.min}–${s.max} min a session` : `${s.min} min a session`);
  if (b.days_per_week) bits.push(`${b.days_per_week} ${b.days_per_week === 1 ? 'day' : 'days'} a week`);
  return bits.join(' · ');
}

/** What they already do — shown because it is the floor every plan gets built from, so a wrong
 *  one is worth catching here rather than in a week of sessions that are too easy. */
function routineLine(b: Baseline): string {
  const sp = b.starting_point;
  if (!sp) return '';
  return [sp.doing_now.join(' · '), sp.trend].filter(Boolean).join(' — ');
}

/** The trailing clause on a constraint: what we do about it, in plain words. */
function constraintNote(c: Constraint): string {
  const bits: string[] = [];
  if (c.status === 'quiet') bits.push('not bothering you now, so we build up gently rather than skip it');
  if (c.until) bits.push(`until ${c.until}`);
  if (c.plan_around) bits.push('we plan around it');
  return bits.join(' · ');
}

export function ConfirmCard({
  onCorrect,
  onTellMore,
  onBuild,
  buildLabel,
}: {
  /** Draft a correction about `topic` into the composer — never a wizard. */
  onCorrect: (topic: string) => void;
  onTellMore: () => void;
  /** Run the build. Omitted only where the host has no build to run — the button then hides. */
  onBuild?: () => void;
  /** "Build it" the first time, "Rebuild my plan" once one exists. The host knows which. */
  buildLabel: string;
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
  const routine = routineLine(baseline);
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
            {g.brief && <div className="cfm-goal-u">{g.brief}</div>}
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
          routine ? (
            <div key="routine" className="cfm-mute">
              Already doing · {routine}
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
            {constraintNote(c) && <span className="cfm-mute"> — {constraintNote(c)}</span>}
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
      {onBuild && (
        <button type="button" className="cfm-build" onClick={onBuild}>
          {buildLabel}
        </button>
      )}
    </div>
  );
}
