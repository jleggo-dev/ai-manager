import { useEffect, useState } from 'react';
import { deriveWalkthrough, nowMenuMeta, type NowMenuItem } from '@cadence/shared';
import { getNowMenu, getRoutines, logAdhoc, type PlanRoutine } from '../../../lib/api.ts';
import { Walkthrough } from '../../walkthrough/Walkthrough.tsx';
import { sessionFor } from '../nowMenuSession.ts';
import { categoryOfArea } from '../../today/category.ts';
import { glyphOf, GLYPH } from '../../today/glyphs.ts';
import type { QuickAddArea } from './quickAddRows.ts';
import { useRoutinePlay } from './useRoutinePlay.tsx';
import { browseAllCount, playableRoutines, routineMeta, shelfRoutines } from './routineShelf.ts';

const DURATION_CHIPS = [15, 30, 45] as const;

/** "A workout" → "Workout"; "Piano" → "Piano" — the article a fallback noun wears reads fine as a
 *  row label but not as the subject of a logged sentence. */
function bareNoun(noun: string): string {
  const stripped = noun.replace(/^(a|an)\s+/i, '').trim();
  return stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : noun;
}

/** "Piano — 30 min", "Workout — 45 min" — deterministic, so the same noun always reads the same
 *  way in the log regardless of which chip (or the custom field) produced it. */
function composeLogText(noun: string, minutes: number): string {
  return `${bareNoun(noun)} — ${minutes} min`;
}

/** The seed sentence "Tell me instead" hands the coach — a plain opener, never a finished claim;
 *  the person finishes it in chat. Movement reads as a verb ("log a run"), practice as time spent
 *  ("log some piano time") — the same split the noun's own copy already makes everywhere else. */
function steerSeed(area: QuickAddArea, noun: string): string {
  const bare = bareNoun(noun);
  const lower = bare.charAt(0).toLowerCase() + bare.slice(1);
  return area === 'movement' ? `I want to log a ${lower}` : `I want to log some ${lower} time`;
}

/**
 * Screen 2 — "the tense" (Activity Builder 2A). Reached by tapping a screen-1 noun row: past
 * ("I went for one") above present ("Take me on one"), because logging is the fastest path and
 * the coach's own present-tense menu is the honest second choice, not the first.
 *
 * No "Build my own" here — the builder doesn't exist yet (TURN 1 of the design), and a dead row
 * beats no row not at all. No Apple Health pull — that's device-gated, a later parcel.
 */
export function QuickAddTense({
  area,
  noun,
  toward,
  onBack,
  onLogged,
  onSteer,
}: {
  area: QuickAddArea;
  noun: string;
  toward?: string;
  onBack: () => void;
  /** Already the sheet's "log it, then close" wrapper (QuickAddSheet.tsx) — every path here
   *  (a chip, the custom minutes field, the free-text line, a finished walkthrough) calls this
   *  ONE callback and nothing else; closing the sheet is not this component's job. */
  onLogged: () => void;
  /** Hands a seed sentence to the coach and switches to her tab — wired at the shell (MainTabs)
   *  the same way PlanView's `onSteerCoach` is. Row hidden without it, same pattern `onOpenFood`
   *  uses on screen 1: a door with nowhere to open is not drawn. */
  onSteer?: (text: string) => void;
}) {
  const [custom, setCustom] = useState('');
  const [freeText, setFreeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [items, setItems] = useState<NowMenuItem[] | null>(null);
  const [playing, setPlaying] = useState<NowMenuItem | null>(null);
  // null = not loaded yet (or the read failed) — same no-claim `getRoutines` already draws between
  // "couldn't load" and "you have none"; `playableRoutines` below collapses both to no rows shown.
  const [routines, setRoutines] = useState<PlanRoutine[] | null>(null);
  // "Browse all N ›" swaps this section, in place, for the full playable-routines list.
  const [browsingRoutines, setBrowsingRoutines] = useState(false);
  const routinePlay = useRoutinePlay(onLogged);

  useEffect(() => {
    let alive = true;
    getNowMenu()
      .then((rows) => {
        if (!alive) return;
        setItems(rows.filter((r) => r.action.kind === 'tool' && r.area === area));
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [area]);

  useEffect(() => {
    let alive = true;
    setBrowsingRoutines(false);
    getRoutines(area).then((rows) => {
      if (alive) setRoutines(rows);
    });
    return () => {
      alive = false;
    };
  }, [area]);

  async function logMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0 || busy) return;
    setBusy(true);
    setNote('');
    const { ok } = await logAdhoc(composeLogText(noun, Math.round(minutes)), undefined, area);
    setBusy(false);
    if (ok) onLogged();
    else setNote("That didn't save — try again in a moment.");
  }

  async function logFree() {
    const t = freeText.trim();
    if (!t || busy) return;
    setBusy(true);
    setNote('');
    const { ok } = await logAdhoc(t, undefined, area);
    setBusy(false);
    if (ok) onLogged();
    else setNote("That didn't save — try again in a moment.");
  }

  // A now-menu row plays through the exact walkthrough a scheduled task uses (DoNowSection's
  // machinery, shared via nowMenuSession.ts) — it overlays the whole screen on its own, so this
  // return replaces everything else here just as it does there.
  if (playing) {
    return (
      <Walkthrough
        walkthrough={deriveWalkthrough(sessionFor(playing))}
        title={playing.label}
        onClose={() => setPlaying(null)}
        onComplete={() => {
          setPlaying(null);
          // `onLogged` is already the sheet's "log it, then close" wrapper (QuickAddSheet.tsx) —
          // the same single call the chip/free-text paths below make.
          onLogged();
        }}
      />
    );
  }

  // A routine's own walkthrough (useRoutinePlay) overlays the same way — one active player at a
  // time, so this return replaces everything else here too.
  if (routinePlay.node) return <>{routinePlay.node}</>;

  const playable = playableRoutines(routines);
  const nowMenuCount = items?.length ?? 0;
  const shownRoutines = shelfRoutines(playable, nowMenuCount);
  const browseCount = browseAllCount(playable, shownRoutines);

  return (
    <>
      <div className="ld2-back">
        <button onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div>
          <b>{noun}</b>
          {toward && <span>toward {toward}</span>}
        </div>
      </div>

      <div className="ld2-sec">
        <b>I went for one</b> <span>log it — it counts</span>
        <div className="ld2-chips">
          {DURATION_CHIPS.map((m) => (
            <button key={m} className="ld2-chip" disabled={busy} onClick={() => void logMinutes(m)}>
              {m} min
            </button>
          ))}
        </div>
        <div className="ld-free" style={{ marginTop: 0 }}>
          <input
            className="ld-input"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="__ min"
            value={custom}
            disabled={busy}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void logMinutes(parseFloat(custom));
            }}
          />
          <button
            className="ld-log"
            disabled={busy || !custom.trim()}
            onClick={() => void logMinutes(parseFloat(custom))}
          >
            Log it
          </button>
        </div>
        <div className="ld2-or">or say what happened</div>
        <div className="ld-free" style={{ marginTop: 0 }}>
          <input
            className="ld-input"
            placeholder={area === 'movement' ? 'e.g. "ran 5k, felt easy"' : 'What did you do?'}
            value={freeText}
            disabled={busy}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void logFree();
            }}
          />
          <button className="ld-log" disabled={busy || !freeText.trim()} onClick={() => void logFree()}>
            Log
          </button>
        </div>
        {note && <div className="ld-empty">{note}</div>}
        {onSteer && (
          <button className="ld-row" onClick={() => onSteer(steerSeed(area, noun))} aria-label="Tell me instead">
            <span className="ld-ic ld-ic-mindset" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d={GLYPH.bubble} fill="#fff" />
              </svg>
            </span>
            <span className="ld-row-t">
              <b>Tell me instead</b>
              <span>tell the coach what happened</span>
            </span>
            <span className="ld-plus" aria-hidden>
              ›
            </span>
          </button>
        )}
      </div>

      {/* Zero now-menu items AND zero playable routines is a real state (DoNowSection's own
          rule) — no heading, no dead row, the section simply isn't here. Browsing mode has its
          own non-empty guard: it only ever opens from "Browse all", which is never drawn unless
          `playable` already has rows. */}
      {(browsingRoutines ? playable.length > 0 : nowMenuCount > 0 || shownRoutines.length > 0) && (
        <div className="ld2-sec">
          {browsingRoutines ? (
            <button
              className="ld2-sec-back"
              onClick={() => setBrowsingRoutines(false)}
              aria-label="Back to Take me on one"
            >
              ‹ Take me on one
            </button>
          ) : (
            <>
              <b>Take me on one</b> <span>from your coach — for right now</span>
            </>
          )}
          <div className="ld-list">
            {!browsingRoutines &&
              items?.map((item) => {
                const glyph = glyphOf(item.label, item.area);
                const meta = nowMenuMeta(item.action);
                return (
                  <button key={item.id} className="ld-row" onClick={() => setPlaying(item)} aria-label={item.label}>
                    <span className={`ld-ic ld-ic-${categoryOfArea(item.area)}`} aria-hidden>
                      <svg viewBox="0 0 24 24" width="20" height="20">
                        <path d={glyph.d} fill="#fff" />
                      </svg>
                    </span>
                    <span className="ld-row-t">
                      <b>{item.label}</b>
                      {meta && <span>{meta}</span>}
                    </span>
                    <span className="ld-plus" aria-hidden>
                      ›
                    </span>
                  </button>
                );
              })}
            {(browsingRoutines ? playable : shownRoutines).map((routine) => (
              <RoutineRow
                key={routine.commitment_id}
                routine={routine}
                area={area}
                busy={routinePlay.busyId === routine.commitment_id}
                errorText={
                  routinePlay.error?.commitmentId === routine.commitment_id ? routinePlay.error.text : undefined
                }
                onPlay={() => routinePlay.play(routine)}
              />
            ))}
          </div>
          {!browsingRoutines && browseCount != null && (
            <button className="ld2-browse-all" onClick={() => setBrowsingRoutines(true)}>
              Browse all {browseCount} ›
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** One routine row — shared by the shelf's top-2 slice and the "Browse all" full list, so the two
 *  views can never drift in what a row looks like or does. `errorText` swaps in for the meta line
 *  the same way `PhotoQuickRow`'s save-state text does (QuickAddRowViews.tsx): the row's own
 *  honest line lives exactly where its ordinary meta would, never a separate block bolted on. */
function RoutineRow({
  routine,
  area,
  busy,
  errorText,
  onPlay,
}: {
  routine: PlanRoutine;
  area: QuickAddArea;
  busy: boolean;
  errorText?: string;
  onPlay: () => void;
}) {
  const routineArea = routine.area ?? area;
  const glyph = glyphOf(routine.title, routineArea);
  return (
    <button className="ld-row" onClick={onPlay} disabled={busy} aria-label={routine.title}>
      <span className={`ld-ic ld-ic-${categoryOfArea(routineArea)}`} aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d={glyph.d} fill="#fff" />
        </svg>
      </span>
      <span className="ld-row-t">
        <b>{routine.title}</b>
        <span>{errorText ?? routineMeta(routine)}</span>
      </span>
      <span className="ld-plus" aria-hidden>
        ›
      </span>
    </button>
  );
}
