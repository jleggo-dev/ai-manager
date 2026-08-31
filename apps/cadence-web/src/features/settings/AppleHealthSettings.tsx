/**
 * Settings — Apple Health import (native shell only; the seam hides this on web).
 *
 * Confirm-first, like everything here: connecting asks HealthKit's permission sheet, and nothing
 * is ever logged silently — recent workouts are listed and each one lands only when tapped. A
 * tapped workout goes through the same off-plan path as "did a hotel yoga class" typed in chat
 * (POST /plan/occurrences/adhoc), so it counts toward consistency exactly like an honest log.
 */
import { useState } from 'react';
import { capabilities, type Workout } from '../../lib/capability/index.ts';
import { logAdhoc } from '../../lib/api.ts';
import { HEALTH_CONNECTED_KEY, humanizeWorkout, workoutLogText } from './health-import.ts';

const RECENT_DAYS = 7;

const dayOf = (iso: string) => iso.slice(0, 10);

export function AppleHealthSettings() {
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!capabilities.health.isAvailable()) return null;

  async function connect() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      await capabilities.health.requestPermissions(['workouts']);
      try {
        window.localStorage.setItem(HEALTH_CONNECTED_KEY, '1');
      } catch {
        /* no localStorage, no matter — the summary row just falls back to "not yet connected" */
      }
      const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
      const recent = await capabilities.health.getWorkouts(since);
      setWorkouts(recent);
      if (recent.length === 0) setMsg(`No workouts in Apple Health from the last ${RECENT_DAYS} days.`);
    } catch {
      setMsg("Couldn't reach Apple Health — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function logOne(w: Workout) {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const { ok } = await logAdhoc(workoutLogText(w), dayOf(w.start));
      if (ok) {
        setLogged((prev) => new Set(prev).add(w.start));
        setMsg('Logged — it counts like anything else you did.');
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
      <div className="diet-block-t">Apple Health</div>
      <div className="diet-block-h">
        Pull in workouts you tracked elsewhere so they can count here. You pick each one — nothing is imported on its
        own. One off-plan log per day: logging a workout replaces anything else you logged off-plan that day.
      </div>

      {workouts === null ? (
        <button type="button" className="set-row" onClick={connect} disabled={busy}>
          <b>Connect Apple Health</b>
          <span>iOS will ask what to share — workouts is all Cadence reads.</span>
        </button>
      ) : (
        <>
          {workouts.map((w) => (
            <button
              type="button"
              key={w.start}
              className="set-row"
              onClick={() => logOne(w)}
              disabled={busy || logged.has(w.start)}
            >
              <b>{humanizeWorkout(w)}</b>
              <span>{logged.has(w.start) ? 'Logged ✓' : `${dayOf(w.start)} — tap to log it`}</span>
            </button>
          ))}
          <button type="button" className="set-row" onClick={connect} disabled={busy}>
            <b>Refresh</b>
            <span>Check Apple Health again</span>
          </button>
        </>
      )}

      {msg && (
        <div className="auth-notice" style={{ marginTop: 6 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
