import { useState } from 'react';
import { logDid, logAdhoc, type PlanActivity } from '../../lib/api.ts';
import { glyphOf } from '../today/glyphs.ts';
import { DoNowSection } from './DoNowSection.tsx';
import { SheetRowsSkeleton } from './SheetSkeletons.tsx';
import { usePlan } from '../../lib/query/index.ts';

/**
 * The goal-aware "＋" sheet — "log something you did." The options are your PLAN's activities (the
 * things tied to your goals), so a tap credits the real activity as done for today even when it was
 * scheduled for another day ("did my Thursday workout on Wednesday"): it counts toward that goal +
 * your streak, and the done node appears on Today. A free-text line at the bottom keeps the honest
 * off-plan path ("did a hotel yoga class") for anything not in the plan. Suggest-never-auto: nothing
 * here changes the plan itself — it only records what already happened.
 */
export function LogDidSheet({ onClose, onLogged }: { onClose: () => void; onLogged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null); // id being logged (or 'free')
  const [text, setText] = useState('');

  /**
   * The plan comes from the shared cache (PERF-03), not a fetch of its own. This sheet used to
   * call `getPlan()` on every open — a second full `/plan` round trip for a list the app was
   * already holding, behind the coach's typing dots. From the cache the ＋ opens with its rows
   * already in it.
   *
   * The old catch also set `[]`, which drew "Nothing in your plan yet — jot it below." over a
   * network failure: a full rhythm reported as an empty one, the exact failure-dressed-as-data
   * shape removed from the routing layer on 2026-08-19. `usePlan` throws instead, so a failure is
   * distinguishable from an honest empty plan and says so below.
   */
  const { data: plan, error } = usePlan();
  // Only the committed-rhythm activities (user-kind) — system weigh-ins + the off-plan bucket
  // aren't things you "did." The plan view already excludes off-plan/episode from `activities`.
  const activities: PlanActivity[] | null = plan ? plan.activities.filter((a) => a.kind === 'user') : null;

  async function pick(a: PlanActivity) {
    if (busy) return;
    setBusy(a.activity_id);
    await logDid(a.activity_id).catch(() => {});
    onLogged();
    onClose();
  }

  async function freeLog() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy('free');
    await logAdhoc(t).catch(() => {});
    onLogged();
    onClose();
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet ld" role="dialog" aria-label="Do something now, or log something you did">
        <div className="sheet-grab" aria-hidden />

        {/* Present tense first — the past is patient. Renders nothing at all when the coach has
            nothing to offer, so the log section simply sits where it always did. */}
        <DoNowSection onClose={onClose} onLogged={onLogged} />
        <div className="ld-split" aria-hidden />

        <div className="ld-head">
          <b>Log something you did</b>
          <span>Tap what you did — it counts even if it wasn&apos;t scheduled for today.</span>
        </div>

        {error && !activities ? (
          // Never "nothing in your plan yet" over a failed read — the free-text line below still
          // works, so the honest sentence keeps the door open without inventing an empty rhythm.
          <div className="ld-empty">{"Couldn't reach your plan just now — jot it below and it still counts."}</div>
        ) : activities === null ? (
          // The plan's own activity list — Postgres, not the coach (PERF-06).
          <SheetRowsSkeleton rows={3} label="Loading what's in your plan." />
        ) : (
          <div className="ld-list">
            {activities.length === 0 ? (
              <div className="ld-empty">Nothing in your plan yet — jot it below.</div>
            ) : (
              activities.map((a) => {
                const { d, cat } = glyphOf(a.title, a.area);
                const meta = [a.cadence, a.time_of_day].filter(Boolean).join(' · ');
                return (
                  <button
                    key={a.activity_id}
                    className="ld-row"
                    onClick={() => pick(a)}
                    disabled={!!busy}
                    aria-label={`Log ${a.title}`}
                  >
                    <span className={`ld-ic ld-ic-${cat}`} aria-hidden>
                      <svg viewBox="0 0 24 24" width="20" height="20">
                        <path d={d} fill="#fff" />
                      </svg>
                    </span>
                    <span className="ld-row-t">
                      <b>{a.title}</b>
                      {meta && <span>{meta}</span>}
                    </span>
                    <span className="ld-plus" aria-hidden>
                      {busy === a.activity_id ? '·' : '＋'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* Always present, never behind the plan's fetch: the off-plan line reads nothing from the
            server, so it is usable on the first frame and survives a failed plan read — which is
            what makes "jot it below" true in both branches above. */}
        <div className="ld-free">
          <input
            className="ld-input"
            placeholder="Something else you did…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void freeLog();
            }}
            disabled={!!busy}
          />
          <button className="ld-log" onClick={() => void freeLog()} disabled={!text.trim() || !!busy}>
            Log
          </button>
        </div>
      </div>
    </>
  );
}
