import { useEffect, useState } from 'react';
import { getConstraints, removeConstraint, renameConstraint, type UserConstraint } from '../../lib/api.ts';
import { ConstraintRow } from './ConstraintRow.tsx';

/**
 * What Cadence is working around, shown to the person it is about.
 *
 * These have always shaped every plan and never been visible anywhere — the coach could see them,
 * the user could not. That gap stopped being theoretical on 2026-08-16: asked to drop the elbow,
 * she said *"Done — I've removed the elbow tendinitis"*, it was still there with `plan_around:
 * true`, and she went on repeating the claim in later turns even though the turn floor hands her
 * the real list on every single message. The owner had no way to check except to ask her again and
 * get the same wrong answer.
 *
 * Owner: *"I feel like we should surface the known constraints in the settings (alongside
 * equipment) that way I can validate them myself."* Right, and the general form of it is the
 * lesson of the whole day: **a fact that shapes every plan should be visible to the person it is
 * about, not only to the model.**
 *
 * Removing here is a plain delete, deliberately unlike the coach's `update_constraint` — which
 * only deletes on an explicit "that was never true", because recovered is not the same as
 * mis-captured (owner ruling). That care is right when a model is inferring intent from prose. It
 * would be condescending when the person whose elbow it is taps a button.
 */
export function ConstraintsSettings() {
  const [items, setItems] = useState<UserConstraint[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    void getConstraints()
      .then((c) => alive && setItems(c))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  async function drop(c: UserConstraint) {
    if (busy) return;
    setBusy(c.id);
    setMsg('');
    const left = await removeConstraint(c.id);
    setBusy(null);
    // The server returns the surviving list, so the screen never guesses at the new state — the
    // whole point of this panel is that it shows what is actually stored.
    if (left) setItems(left);
    else setMsg("That didn't save just now — try again in a moment.");
  }

  async function rename(c: UserConstraint, label: string) {
    if (busy) return;
    setBusy(c.id);
    setMsg('');
    const next = await renameConstraint(c.id, label);
    setBusy(null);
    if (next) setItems(next);
    else setMsg("That didn't save just now — try again in a moment.");
  }

  if (items === null) return null;

  return (
    <div className="set-block">
      <div className="set-h">What we work around</div>
      {items.length === 0 ? (
        <div className="set-note">Nothing on file. Cadence is planning without anything to work around.</div>
      ) : (
        <ul className="cons-list">
          {items.map((c) => (
            <ConstraintRow
              key={c.id}
              constraint={c}
              busy={busy === c.id}
              onRename={(label) => rename(c, label)}
              onRemove={() => void drop(c)}
            />
          ))}
        </ul>
      )}
      {msg && <div className="auth-error">{msg}</div>}
      <div className="set-note">
        Reword one if it doesn&apos;t sound like you — the wording is yours. Removing one takes it off your file for
        good; telling Cadence it has eased off is the gentler move, since she keeps it in mind without planning around
        it.
      </div>
    </div>
  );
}
