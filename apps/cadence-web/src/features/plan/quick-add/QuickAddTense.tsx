import { useEffect, useState } from 'react';
import { deriveWalkthrough, nowMenuMeta, type NowMenuItem } from '@cadence/shared';
import {
  getNowMenu,
  getRoutines,
  listUserRoutines,
  logAdhoc,
  logUserRoutineRun,
  type PlanRoutine,
  type UserRoutine,
} from '../../../lib/api.ts';
import { Walkthrough } from '../../walkthrough/Walkthrough.tsx';
import { sessionFor } from '../nowMenuSession.ts';
import { categoryOfArea } from '../../today/category.ts';
import { glyphOf, GLYPH } from '../../today/glyphs.ts';
import type { QuickAddArea } from './quickAddRows.ts';
import { useRoutinePlay } from './useRoutinePlay.tsx';
import { browseAllCount, fillShelfSlots, playableRoutines, routineMeta, SHELF_ROW_CAP } from './routineShelf.ts';
import { playableUserRoutines, userRoutineMeta } from './userRoutineShelf.ts';
import type { BuilderSeed } from './builderSeed.ts';
import { StartFromScreen } from './StartFromScreen.tsx';

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
 * the coach's own present-tense menu is the honest second choice, not the first. "Take me on one"
 * now lists three tiers in order — the coach's now-menu tools, her routines, then the user's own
 * ("Yours") — sharing the Now Door's one 5-row cap; "Build my own" is the screen's last door, into
 * `StartFromScreen.tsx`'s three starting-point shelves (Activity Builder wave 3).
 *
 * No Apple Health pull — that's device-gated, a later parcel.
 */
export function QuickAddTense({
  area,
  noun,
  toward,
  onBack,
  onLogged,
  onSteer,
  onBuild,
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
  /** Opens the Activity Builder full-screen, seeded (or not — "Blank") from `StartFromScreen`'s
   *  pick — wired at the shell (MainTabs) the same way `onSteer` is. "Build my own" and the whole
   *  Start-from screen are hidden without it: no door without a house. */
  onBuild?: (seed?: BuilderSeed) => void;
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
  // Same no-claim reading of `listUserRoutines` — it carries every area, filtered to this one at
  // render time (the endpoint itself has no `?area=`, unlike `getRoutines`).
  const [userRoutines, setUserRoutines] = useState<UserRoutine[] | null>(null);
  // "Browse all N ›" swaps this section, in place, for the full playable-routines list (both
  // tiers). "Build my own" swaps the WHOLE screen for `StartFromScreen` — a bigger, separate
  // concern, so it gets its own flag rather than living inside the routines section's toggle.
  const [browsingRoutines, setBrowsingRoutines] = useState(false);
  const [buildingFrom, setBuildingFrom] = useState(false);
  const [playingUserRoutine, setPlayingUserRoutine] = useState<UserRoutine | null>(null);
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

  useEffect(() => {
    let alive = true;
    listUserRoutines().then((rows) => {
      if (alive) setUserRoutines(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

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

  // A coach routine's own walkthrough (useRoutinePlay) overlays the same way — one active player
  // at a time, so this return replaces everything else here too.
  if (routinePlay.node) return <>{routinePlay.node}</>;

  // A "Yours" row plays straight from the session already in hand — no fetch, unlike a coach
  // routine, so there is no busy/error state to carry here, just the same overlay-and-credit shape.
  if (playingUserRoutine) {
    return (
      <Walkthrough
        walkthrough={deriveWalkthrough(playingUserRoutine.session)}
        title={playingUserRoutine.name}
        onClose={() => setPlayingUserRoutine(null)}
        onComplete={() => {
          const routineId = playingUserRoutine.routine_id;
          setPlayingUserRoutine(null);
          // logUserRoutineRun, THEN onLogged — same order every completed path here follows.
          void (async () => {
            try {
              await logUserRoutineRun(routineId);
            } finally {
              onLogged();
            }
          })();
        }}
      />
    );
  }

  const playableCoach = playableRoutines(routines);
  const userForArea = userRoutines?.filter((r) => r.area === area) ?? null;
  const playableUser = playableUserRoutines(userForArea);

  // "Build my own" opens a bigger, separate screen (three whole shelves) rather than swapping
  // just the routines section the way "Browse all" does — so it gets its own full-body return,
  // same shape as `playing`/`routinePlay.node` above.
  if (buildingFrom && onBuild) {
    return (
      <StartFromScreen
        area={area}
        coachRoutines={playableCoach}
        userRoutines={playableUser}
        onBack={() => setBuildingFrom(false)}
        onBuild={(seed) => {
          setBuildingFrom(false);
          onBuild(seed);
        }}
      />
    );
  }

  // Three tiers share the Now Door's one 5-row cap, in listed order: now-menu items claim their
  // slots first (unlimited — they're the coach's own present-tense picks), then coach routines,
  // then the user's own. Each of the latter two is ALSO capped per tier (`fillShelfSlots`), so a
  // person with 20 saved routines still only ever sees the top 2 here — Browse all reaches the rest.
  const nowMenuCount = items?.length ?? 0;
  const shownCoach = fillShelfSlots(playableCoach, Math.max(0, SHELF_ROW_CAP - nowMenuCount));
  const shownUser = fillShelfSlots(playableUser, Math.max(0, SHELF_ROW_CAP - nowMenuCount - shownCoach.length));
  const browseCount = browseAllCount(playableCoach.length + playableUser.length, shownCoach.length + shownUser.length);

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

      {/* Zero now-menu items AND zero playable routines (either tier) is a real state (DoNowSection's
          own rule) — no heading, no dead row, the section simply isn't here. Browsing mode has its
          own non-empty guard: it only ever opens from "Browse all", which is never drawn unless
          either tier already has rows. */}
      {(browsingRoutines
        ? playableCoach.length + playableUser.length > 0
        : nowMenuCount > 0 || shownCoach.length > 0 || shownUser.length > 0) && (
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
            {(browsingRoutines ? playableCoach : shownCoach).map((routine) => (
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
            {(browsingRoutines ? playableUser : shownUser).map((routine) => (
              <UserRoutineRow
                key={routine.routine_id}
                routine={routine}
                area={area}
                onPlay={() => setPlayingUserRoutine(routine)}
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

      {/* "Build my own" (Activity Builder wave 3) — the screen's last door, drawn in the dashed
          not-yet-real register so it never competes with a row that already logs or plays
          something real. Hidden entirely without a house to open it into (same rule `onSteer`
          follows above): MainTabs is the only host that wires `onBuild` today. */}
      {onBuild && (
        <button className="ld-build-row" onClick={() => setBuildingFrom(true)} aria-label="Build my own">
          <span className={`ld-ic ld-ic-${categoryOfArea(area)}`} aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d={GLYPH.pen} fill="#fff" />
            </svg>
          </span>
          <span className="ld-row-t">
            <b>Build my own</b>
            <span>start from one of these, or from scratch</span>
          </span>
          <span className="ld-plus" aria-hidden>
            ›
          </span>
        </button>
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

/** A user-built routine's own row — same grammar as `RoutineRow`, but no busy/error state: playing
 *  one needs no fetch (the session is already in hand from `listUserRoutines`), so there is
 *  nothing here that can fail. The "yours" word leads the meta line — a quiet chip, not a
 *  separate line, the same one-line-of-facts shape every row in this sheet already wears. */
function UserRoutineRow({ routine, area, onPlay }: { routine: UserRoutine; area: QuickAddArea; onPlay: () => void }) {
  const routineArea = routine.area ?? area;
  const glyph = glyphOf(routine.name, routineArea);
  const meta = ['yours', userRoutineMeta(routine)].filter((p): p is string => !!p).join(' · ');
  return (
    <button className="ld-row" onClick={onPlay} aria-label={routine.name}>
      <span className={`ld-ic ld-ic-${categoryOfArea(routineArea)}`} aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d={glyph.d} fill="#fff" />
        </svg>
      </span>
      <span className="ld-row-t">
        <b>{routine.name}</b>
        <span>{meta}</span>
      </span>
      <span className="ld-plus" aria-hidden>
        ›
      </span>
    </button>
  );
}
