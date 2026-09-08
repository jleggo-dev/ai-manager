/**
 * Settings → Apple Health → Workouts: the import list (native shell only; the seam hides this on
 * web). Reached through the "Workouts" door under the Apple Health toggle, so by the time this
 * mounts the permission has already been asked for — the list loads on mount and "Refresh"
 * re-reads it (owner, 2026-09-07: no "Connect" button here any more).
 *
 * Confirm-first, like everything here: nothing is ever logged silently — recent workouts are
 * listed and each one lands only when tapped. A tapped workout goes through the same off-plan path
 * as "did a hotel yoga class" typed in chat (POST /plan/occurrences/adhoc), so it counts toward
 * consistency exactly like an honest log.
 */
import { useEffect, useState } from 'react';
import { capabilities, type Workout } from '../../lib/capability/index.ts';
import { logAdhoc } from '../../lib/api.ts';
import { humanizeWorkout, workoutLogText } from './health-import.ts';

const RECENT_DAYS = 7;

const dayOf = (iso: string) => iso.slice(0, 10);

export function AppleHealthSettings() {
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  /** Bumped by "Refresh" — the effect below is the one and only reader of HealthKit here. */
  const [tick, setTick] = useState(0);
  const available = capabilities.health.isAvailable();

  useEffect(() => {
    if (!available) return;
    let alive = true;
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
    capabilities.health
      .getWorkouts(since)
      .then((recent) => {
        if (!alive) return;
        setWorkouts(recent);
        setMsg(recent.length === 0 ? `No workouts in Apple Health from the last ${RECENT_DAYS} days.` : '');
      })
      .catch(() => {
        if (alive) setMsg("Couldn't reach Apple Health — try again in a moment.");
      });
    return () => {
      alive = false;
    };
  }, [available, tick]);

  if (!available) return null;

  async function logOne(w: Workout) {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const { ok } = await logAdhoc(workoutLogText(w), dayOf(w.start));
      if (ok) {
        setLogged((prev) => new Set(prev).add(w.start));
        setMsg('Logged.');
      } else {
        setMsg("That didn't log — is your plan set yet?");
      }
    } catch {
      setMsg("That didn't log — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="diet-block" style={{ marginTop: 12 }}>
      {workouts === null && !msg && (
        <div className="sheet-msg" style={{ padding: '6px 0 8px' }}>
          Loading…
        </div>
      )}

      {workouts?.map((w) => (
        <button
          type="button"
          key={w.start}
          className="set-row"
          onClick={() => void logOne(w)}
          disabled={busy || logged.has(w.start)}
        >
          <b>{humanizeWorkout(w)}</b>
          <span>{logged.has(w.start) ? 'Logged ✓' : dayOf(w.start)}</span>
        </button>
      ))}

      <button
        type="button"
        className="set-row"
        onClick={() => {
          setMsg('');
          setTick((t) => t + 1);
        }}
        disabled={busy}
      >
        <b>Refresh</b>
      </button>

      {msg && (
        <div className="auth-notice" style={{ marginTop: 6 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
