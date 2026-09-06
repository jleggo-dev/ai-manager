import { useEffect, useState } from 'react';
import type { NowMenuItem } from '@cadence/shared';
import { getNowMenu, logAdhoc } from '../../../lib/api.ts';
import { useNutritionDay, usePlan, useProgressPhotosStatus } from '../../../lib/query/index.ts';
import { DoNowSection } from '../DoNowSection.tsx';
import { SheetRowsSkeleton } from '../SheetSkeletons.tsx';
import { GLYPH } from '../../today/glyphs.ts';
import { deriveQuickAddRows, type QuickAddArea } from './quickAddRows.ts';
import { AreaQuickRow, MealQuickRow, PhotoQuickRow, WaterQuickRow, WeightQuickRow } from './QuickAddRowViews.tsx';
import { QuickAddPill } from './QuickAddPill.tsx';
import { QuickAddTense } from './QuickAddTense.tsx';
import { useRoutinePlay } from './useRoutinePlay.tsx';
import type { BuilderSeed } from './builderSeed.ts';

/** Screen 1's noun, carried to screen 2 (Activity Builder 2A) — everything QuickAddTense needs to
 *  know which area it's logging into and what to call the thing. */
type TenseScreen = { area: QuickAddArea; noun: string; toward?: string };

/**
 * The ＋ sheet: **quick add** — captures derived from what the user already tracks (owner,
 * 2026-09-01) — plus a free-text line for everything else. It replaced the "log something you
 * did" list of the plan's own activities: those rows duplicated the trail's buttons, and the menu
 * offered nothing for the things people actually reach for a ＋ to do — a glass of water, an extra
 * workout, a weight on an off day. deriveQuickAddRows (quickAddRows.ts) owns which rows exist.
 *
 * Noun-first (Activity Builder 2A, 2026-09-01): a movement/practice row is the thing itself —
 * "Piano", not "Add a practice" — and tapping it swaps this whole body for `screen`, "the tense"
 * (QuickAddTense.tsx): log it, tell the coach, or take the coach's present-tense menu scoped to
 * that noun. Water, meal, weight and photo stay one-step, unchanged.
 *
 * The coach's present-tense menu itself (device-test ruling, 2026-09-01) is no longer a top-level
 * section: it used to mount DoNowSection above "Quick add" and pop the whole layout down once its
 * own fetch resolved — a squish bug under a thumb mid-tap — and a menu of mind tools nobody
 * prescribed FOR THIS USER broke the sheet's law regardless of the bug. It's now fetched once here
 * (`nowItems`, same alive-guard idiom as the photos-status effect) and demoted to one ordinary
 * row, "Calming techniques", that opens `calmingOpen`'s sub-screen — DoNowSection is purely
 * presentational now, fed `nowItems` wherever it's shown.
 *
 * The plan comes from the shared cache (PERF-03) and the nutrition day from its shared query —
 * every extra fetch this sheet makes of its own (photos opt-in, now-menu) soft-fails to empty: a
 * blip hides a row, it never invents one.
 */
export function QuickAddSheet({
  onClose,
  onLogged,
  onOpenFood,
  onSteer,
  onBuild,
}: {
  onClose: () => void;
  onLogged: () => void;
  /** The meal row's door — the food module's Log screen. Row hidden when the host has no door. */
  onOpenFood?: () => void;
  /** Screen 2's "Tell me instead" — hands a seed sentence to the coach. Wired at the shell
   *  (MainTabs) the same way PlanView's `onSteerCoach` is; the row hides itself without it. */
  onSteer?: (text: string) => void;
  /** Screen 2's "Build my own" → Start from (Activity Builder wave 3). Wired at the shell the same
   *  way `onSteer` is; hidden everywhere without it. */
  onBuild?: (seed?: BuilderSeed) => void;
}) {
  const [busy, setBusy] = useState(false); // the free line's in-flight guard
  const [text, setText] = useState('');
  /** The free line's honest-failure note — set only when a log came back not-saved. */
  const [freeNote, setFreeNote] = useState('');
  /** At most one row expanded at a time — a sheet of open forms is a form, not a quick add. */
  const [open, setOpen] = useState<'weight' | null>(null);
  /** Screen 1 → screen 2 (Activity Builder 2A): set by tapping a movement/practice noun row,
   *  cleared by its back affordance. Replaces the whole sheet body while it's set — the coach's
   *  present-tense menu and the free line belong to screen 1, not the noun's own screen. */
  const [screen, setScreen] = useState<TenseScreen | null>(null);
  /** Screen 1 → the "Calming techniques" sub-screen (device-test ruling, 2026-09-01): set by
   *  tapping the row below, cleared by its back affordance. A top-level section of mind tools the
   *  coach didn't prescribe FOR THIS USER broke the sheet's law, so it demoted to one row like
   *  everything else — the sub-screen is just `nowItems` handed to DoNowSection as its content. */
  const [calmingOpen, setCalmingOpen] = useState(false);

  /**
   * A failed plan read is UNKNOWN, never an empty plan (the 2026-08-19 rule): `usePlan` throws on
   * failure, so the error branch below can say "couldn't reach" while the free line keeps working.
   */
  const { data: plan, error } = usePlan();
  const { data: day } = useNutritionDay();
  // The same cached opt-in state Settings' toggle writes, so the row is either here or not the
  // moment the sheet opens — never appearing under the reader's thumb a beat later.
  const { data: photos } = useProgressPhotosStatus();
  const photosEnabled = photos?.enabled ?? false;

  /**
   * The now-menu, fetched once here instead of inside DoNowSection (device-test bug, 2026-09-01):
   * DoNowSection used to fetch it itself and pop its own pinned-item/rows chrome in above "Quick
   * add" once the fetch resolved, squishing the section down to barely usable under a thumb
   * mid-tap. Lifting the fetch means screen 1 renders its final layout on the first frame;
   * DoNowSection is now purely presentational, fed `nowItems` wherever it's shown (the Calming
   * sub-screen, below). A failed fetch = empty = no claim, same as the photos-status effect above.
   */
  const [nowItems, setNowItems] = useState<NowMenuItem[]>([]);
  useEffect(() => {
    let alive = true;
    getNowMenu()
      .then((menuRows) => {
        // Activity rows need a deep-link into that task's own flow, which doesn't exist yet — they
        // are dropped rather than rendered as something that wouldn't work under a thumb (the same
        // filter DoNowSection applied itself before this fetch moved up here).
        if (alive) setNowItems(menuRows.filter((r) => r.action.kind === 'tool'));
      })
      .catch(() => {
        if (alive) setNowItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  /** The coach's own pinned "do something now" item outranks the express-lane pill's usage-stats
   *  shortcut (Now Door's promotion hierarchy) — see QuickAddPill's `suppressed` prop below. */
  const hasPin = nowItems.some((i) => i.pinned);

  /**
   * The free line checks `ok` the way screen 2's paths always did — the sweep (W2-C, 2026-09-01)
   * caught this one still swallowing a server-side `ok: false` and closing as if it saved, the
   * exact pressing-a-button-didn't-log shape the owner flagged. A failure keeps the sheet open
   * and says so; only a real save closes.
   */
  async function freeLog() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setFreeNote('');
    const { ok } = await logAdhoc(t).catch(() => ({ ok: false }));
    setBusy(false);
    if (!ok) {
      setFreeNote("That didn't save — try again in a moment.");
      return;
    }
    onLogged();
    onClose();
  }

  /** The pill's play-then-credit — the same hook QuickAddTense uses for its routine rows, given
   *  the same "log it, then close" wrapper, so a pill run and a shelf run are one behavior. */
  const pillPlay = useRoutinePlay(() => {
    onLogged();
    onClose();
  });

  const planLoading = plan === undefined && !error;
  const rows = deriveQuickAddRows({
    plan: plan ?? null,
    day: day ?? null,
    photosEnabled,
    hasCalming: nowItems.length > 0,
  });

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet ld" role="dialog" aria-label="Quick add">
        <div className="sheet-grab" aria-hidden />

        {pillPlay.node ? (
          pillPlay.node
        ) : screen ? (
          <QuickAddTense
            area={screen.area}
            noun={screen.noun}
            toward={screen.toward}
            onBack={() => setScreen(null)}
            onLogged={() => {
              onLogged();
              onClose();
            }}
            onSteer={
              onSteer &&
              ((seed) => {
                onSteer(seed);
                onClose();
              })
            }
            onBuild={
              onBuild &&
              ((seed) => {
                onBuild(seed);
                onClose();
              })
            }
          />
        ) : calmingOpen ? (
          <>
            {/* Same in-sheet swap the tense screen uses, and the same `.ld2-back` grammar — back
                returns to screen 1, never closes the sheet itself. */}
            <div className="ld2-back">
              <button onClick={() => setCalmingOpen(false)} aria-label="Back">
                ‹
              </button>
              <div>
                <b>Calming techniques</b>
              </div>
            </div>
            {/* DoNowSection's own onClose/onLogged contract is unchanged — playing an item through
                to completion still logs and closes the WHOLE sheet, exactly as it did when this
                was a top-level section. */}
            <DoNowSection items={nowItems} onClose={onClose} onLogged={onLogged} />
          </>
        ) : (
          <>
            <div className="ld-head">
              <b>Quick add</b>
              <span>Log what just happened — it counts, scheduled or not.</span>
            </div>

            {/* The express lane (Activity Builder W2-B): the user's most-used routine, above the
                derived rows below. Renders nothing on its own — no candidate, a failed read, or
                the coach's own pinned item (hasPin) all fall through to nothing here. */}
            <QuickAddPill suppressed={hasPin} onPlay={pillPlay.play} />
            {pillPlay.error && <div className="ld-empty">{pillPlay.error.text}</div>}

            {planLoading ? (
              // The plan's rows aren't derivable yet — shapes, never invented rows (components/Skeleton.tsx).
              <SheetRowsSkeleton rows={3} label="Reading what you track." />
            ) : (
              <>
                {error && !plan && (
                  // Never a bare list over a failed read — the derivation is missing its plan
                  // half, and the honest sentence keeps the door open without inventing an empty
                  // rhythm.
                  <div className="ld-empty">
                    {"Couldn't reach your plan just now — jot it below and it still counts."}
                  </div>
                )}
                <div className="ld-list">
                  {rows.length === 0 && !error ? (
                    <div className="ld-empty">Nothing to quick-add yet — jot it below and it still counts.</div>
                  ) : (
                    rows.map((row) => {
                      switch (row.kind) {
                        case 'water':
                          return <WaterQuickRow key="water" initialMl={day?.water_ml ?? 0} />;
                        case 'meal':
                          return onOpenFood ? <MealQuickRow key="meal" onOpenFood={onOpenFood} /> : null;
                        case 'weight':
                          return (
                            <WeightQuickRow
                              key="weight"
                              open={open === 'weight'}
                              onToggle={() => setOpen(open === 'weight' ? null : 'weight')}
                            />
                          );
                        case 'add':
                          return (
                            <AreaQuickRow
                              key={row.area}
                              area={row.area}
                              noun={row.noun}
                              toward={row.toward}
                              onSelect={() => setScreen({ area: row.area, noun: row.noun, toward: row.toward })}
                            />
                          );
                        case 'calming':
                          // One master row like everything else (device-test ruling, 2026-09-01) —
                          // the `.ld-row` grammar every row above it wears, opening the items as a
                          // sub-screen rather than a top-level section of its own.
                          return (
                            <button
                              key="calming"
                              className="ld-row"
                              onClick={() => setCalmingOpen(true)}
                              aria-label="Calming techniques"
                            >
                              <span className="ld-ic ld-ic-mindset" aria-hidden>
                                <svg viewBox="0 0 24 24" width="20" height="20">
                                  <path d={GLYPH.sun} fill="#fff" />
                                </svg>
                              </span>
                              <span className="ld-row-t">
                                <b>Calming techniques</b>
                                <span>from your coach — for right now</span>
                              </span>
                              <span className="ld-plus" aria-hidden>
                                ›
                              </span>
                            </button>
                          );
                        case 'photo':
                          return <PhotoQuickRow key="photo" />;
                      }
                    })
                  )}
                </div>
              </>
            )}

            {/* Always present, never behind any fetch: the free line reads nothing from the
                server, so it is usable on the first frame and survives a failed plan read — which
                is what makes "jot it below" true in both branches above. */}
            <div className="ld-free">
              <input
                className="ld-input"
                placeholder="Something else you did…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void freeLog();
                }}
                disabled={busy}
              />
              <button className="ld-log" onClick={() => void freeLog()} disabled={!text.trim() || busy}>
                Log
              </button>
            </div>
            {freeNote && <div className="ld-empty">{freeNote}</div>}
          </>
        )}
      </div>
    </>
  );
}
