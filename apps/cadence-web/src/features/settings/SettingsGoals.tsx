/**
 * Settings Room 1c — "Your goals": the door, not the editor. Rename or retire a goal that has
 * already been confirmed/committed; nothing about what a goal MEANS (target, deadline, area) is
 * editable here — that stays a conversation with the coach, reached through the dashed door at the
 * bottom. Standalone: fetches its own data via getReview() and takes only onBack/onCoach.
 *
 * Rename/retire ride the SR-1 seam (goalApi.shim.ts) — see that file for why retiring a goal
 * doesn't yet round-trip against a real server route.
 */
import { useEffect, useState } from 'react';
import type { Goal, GoalType } from '@cadence/shared';
import { getReview } from '../../lib/api.ts';
import { renameGoal, retireGoal } from './goalApi.shim.ts';
import '../../styles/settings-editors.css';

/** The mono meta line's opening word — how each goal TYPE reads as a measurement kind. Only one
 *  concrete example rode the design brief ("TREND · TARGET 78 KG · NO DEADLINE", a target-type
 *  weight goal); milestone/recurring wording here is this parcel's best-fit extension of that one
 *  data point, not a second verbatim spec. */
const KIND_WORD: Record<GoalType, string> = { target: 'TREND', milestone: 'MILESTONE', recurring: 'HABIT' };

function shortDate(iso: string): string {
  try {
    return new Date(`${iso.slice(0, 10)}T12:00:00`)
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      .toUpperCase();
  } catch {
    return iso;
  }
}

/** "TREND · TARGET 78 KG · NO DEADLINE" — measure (when the type carries one) then the deadline,
 *  each part only as present as the goal actually is (CLAUDE.md: count what happened). */
function metaLine(g: Goal): string {
  const parts: string[] = [KIND_WORD[g.type]];
  const target = g.measure?.target;
  if (target != null && String(target).trim() !== '' && (g.type === 'target' || g.type === 'recurring')) {
    const val = [target, g.measure?.unit].filter((x) => x != null && String(x).trim() !== '').join(' ');
    parts.push(g.type === 'target' ? `TARGET ${val}`.toUpperCase() : val.toUpperCase());
  }
  const end = g.timeframe?.end;
  parts.push(end ? `DEADLINE ${shortDate(end)}` : 'NO DEADLINE');
  return parts.join(' · ');
}

const COACH_NOTE =
  'They opened the goal door in Settings — they want a goal to mean something different (not a ' +
  'rename or a retire, which they can already do there themselves). Ask what changed for them and ' +
  'help reshape the goal together; a new target, deadline, or area is your conversation to have.';

export function SettingsGoals({ onBack, onCoach }: { onBack: () => void; onCoach?: (note: string) => void }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    getReview()
      .then((r) => {
        if (alive) setGoals(r.goals.filter((g) => g.status === 'confirmed' || g.status === 'committed'));
      })
      .catch(() => {
        if (alive) setLoadErr(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function doRename(goal: Goal, title: string) {
    const next = title.trim();
    setRenaming(null);
    if (!next || next === goal.title || !goals) return;
    setBusy(true);
    setMsg('');
    try {
      const ok = await renameGoal(goal.goal_id, next);
      if (ok) setGoals(goals.map((g) => (g.goal_id === goal.goal_id ? { ...g, title: next } : g)));
      else setMsg("That didn't go through — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function doRetire(goal: Goal) {
    if (!goals) return;
    setBusy(true);
    setMsg('');
    try {
      const ok = await retireGoal(goal.goal_id);
      if (ok) {
        setGoals(goals.filter((g) => g.goal_id !== goal.goal_id));
        setRetiring(null);
      } else {
        setMsg("That didn't go through — try again in a moment.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fh">
      <div className="fh-head">
        <button className="fh-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <b className="fh-title">Goals</b>
      </div>
      <div className="fh-body">
        <div className="se-kicker">Rename or retire a goal</div>

        <div className="se-card">
          {loadErr && <div className="se-note">{"Couldn't load your goals just now — try again shortly."}</div>}
          {goals === null && !loadErr && <div className="se-empty">Loading…</div>}
          {goals !== null && goals.length === 0 && <div className="se-empty">No goals to show yet.</div>}
          {goals !== null &&
            goals.map((g) =>
              renaming === g.goal_id ? (
                <RenameRow key={g.goal_id} goal={g} busy={busy} onSave={(t) => void doRename(g, t)} />
              ) : (
                <GoalRow
                  key={g.goal_id}
                  goal={g}
                  menuOpen={menuFor === g.goal_id}
                  onToggleMenu={() => setMenuFor(menuFor === g.goal_id ? null : g.goal_id)}
                  onRename={() => {
                    setMenuFor(null);
                    setRenaming(g.goal_id);
                  }}
                  onRetire={() => {
                    setMenuFor(null);
                    setRetiring(g);
                  }}
                />
              ),
            )}
        </div>

        {msg && <div className="se-note">{msg}</div>}

        {onCoach && (
          <button className="se-coach-door" onClick={() => onCoach(COACH_NOTE)}>
            <b>Want a goal to mean something different?</b>
            <span>Talk it through with Cadence — tapping this drafts the message in your words.</span>
          </button>
        )}
      </div>

      {retiring && (
        <RetireConfirm goal={retiring} busy={busy} onKeep={() => setRetiring(null)} onRetire={() => void doRetire(retiring)} />
      )}
    </div>
  );
}

function GoalRow({
  goal: g,
  menuOpen,
  onToggleMenu,
  onRename,
  onRetire,
}: {
  goal: Goal;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onRename: () => void;
  onRetire: () => void;
}) {
  return (
    <div className="se-goal-row">
      <span className={`se-dot se-dot-${g.area}`} aria-hidden />
      <span className="se-goal-t">
        <b>{g.title}</b>
        <span className="se-goal-meta">{metaLine(g)}</span>
      </span>
      <span className="se-kebab-wrap">
        <button className="se-kebab-btn" onClick={onToggleMenu} aria-label={`Options for ${g.title}`}>
          ⋯
        </button>
        {menuOpen && (
          <div className="se-kebab-menu" role="menu">
            <button role="menuitem" onClick={onRename}>
              Rename
            </button>
            <button role="menuitem" className="se-danger" onClick={onRetire}>
              Retire…
            </button>
          </div>
        )}
      </span>
    </div>
  );
}

function RenameRow({ goal: g, busy, onSave }: { goal: Goal; busy: boolean; onSave: (title: string) => void }) {
  const [draft, setDraft] = useState(g.title);
  return (
    <div className="se-goal-row">
      <span className={`se-dot se-dot-${g.area}`} aria-hidden />
      <span className="se-rename-row">
        <input
          className="wiz-in"
          value={draft}
          autoFocus
          disabled={busy}
          aria-label={`Rename ${g.title}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(draft);
            if (e.key === 'Escape') onSave(g.title);
          }}
        />
        <button className="se-rename-save" disabled={busy} onClick={() => onSave(draft)}>
          Save
        </button>
        <button className="se-rename-cancel" disabled={busy} onClick={() => onSave(g.title)}>
          Cancel
        </button>
      </span>
    </div>
  );
}

function RetireConfirm({
  goal: g,
  busy,
  onKeep,
  onRetire,
}: {
  goal: Goal;
  busy: boolean;
  onKeep: () => void;
  onRetire: () => void;
}) {
  return (
    <div className="se-confirm-scrim" onClick={busy ? undefined : onKeep}>
      <div className="se-confirm-card" role="dialog" aria-label={`Retire ${g.title}`} onClick={(e) => e.stopPropagation()}>
        <div className="se-confirm-t">Retire &quot;{g.title}&quot;?</div>
        <div className="se-confirm-body">
          It stops shaping your weeks from Monday. Everything it built stays in Progress. If you change your mind,
          tell Cadence and she&apos;ll bring it back.
        </div>
        <div className="se-confirm-actions">
          <button className="se-keep-btn" disabled={busy} onClick={onKeep}>
            Keep it
          </button>
          <button className="se-retire-btn" disabled={busy} onClick={onRetire}>
            {busy ? 'Retiring…' : 'Retire it'}
          </button>
        </div>
      </div>
    </div>
  );
}
