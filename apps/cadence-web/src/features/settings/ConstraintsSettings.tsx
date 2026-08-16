import { useEffect, useState } from 'react';
import { getConstraints, removeConstraint, type UserConstraint } from '../../lib/api.ts';

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

  if (items === null) return null;

  return (
    <div className="set-block">
      <div className="set-h">What we work around</div>
      {items.length === 0 ? (
        <div className="set-note">Nothing on file. Cadence is planning without anything to work around.</div>
      ) : (
        <ul className="cons-list">
          {items.map((c) => (
            <li key={c.id} className="cons-row">
              <span className="cons-what">
                <b>{c.label}</b>
                <span>
                  {/* `plan_around` is the one that actually changes the plan, so it leads. Status is
                      how it is doing; a quiet constraint is still planned around until it is not. */}
                  {c.plan_around === false ? 'not planned around' : 'planned around'}
                  {c.status ? ` · ${c.status}` : ''}
                </span>
              </span>
              <button
                className="cons-drop"
                onClick={() => void drop(c)}
                disabled={!!busy}
                aria-label={`Remove ${c.label}`}
              >
                {busy === c.id ? '…' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <div className="auth-error">{msg}</div>}
      <div className="set-note">
        Removing one here takes it off your file for good. Telling Cadence it has eased off is the gentler move — she
        keeps it in mind without planning around it.
      </div>
    </div>
  );
}
