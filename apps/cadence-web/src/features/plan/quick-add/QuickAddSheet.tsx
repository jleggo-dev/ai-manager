import { useEffect, useState } from 'react';
import { getProgressPhotosStatus, logAdhoc } from '../../../lib/api.ts';
import { useNutritionDay, usePlan } from '../../../lib/query/index.ts';
import { DoNowSection } from '../DoNowSection.tsx';
import { SheetRowsSkeleton } from '../SheetSkeletons.tsx';
import { deriveQuickAddRows, type QuickAddArea } from './quickAddRows.ts';
import { AreaQuickRow, MealQuickRow, PhotoQuickRow, WaterQuickRow, WeightQuickRow } from './QuickAddRowViews.tsx';
import { QuickAddTense } from './QuickAddTense.tsx';

/** Screen 1's noun, carried to screen 2 (Activity Builder 2A) — everything QuickAddTense needs to
 *  know which area it's logging into and what to call the thing. */
type TenseScreen = { area: QuickAddArea; noun: string; toward?: string };

/**
 * The ＋ sheet: "do something now" (the coach's present-tense menu), then **quick add** — captures
 * derived from what the user already tracks (owner, 2026-09-01), and a free-text line for
 * everything else. It replaced the "log something you did" list of the plan's own activities:
 * those rows duplicated the trail's buttons, and the menu offered nothing for the things people
 * actually reach for a ＋ to do — a glass of water, an extra workout, a weight on an off day.
 * deriveQuickAddRows (quickAddRows.ts) owns which rows exist; the two rules live there.
 *
 * Noun-first (Activity Builder 2A, 2026-09-01): a movement/practice row is the thing itself —
 * "Piano", not "Add a practice" — and tapping it swaps this whole body for `screen`, "the tense"
 * (QuickAddTense.tsx): log it, tell the coach, or take the coach's present-tense menu scoped to
 * that noun. Water, meal, weight and photo stay one-step, unchanged.
 *
 * The plan comes from the shared cache (PERF-03) and the nutrition day from its shared query —
 * this sheet adds one light fetch of its own (the photos opt-in), which soft-fails to "off": a
 * blip hides a row, it never invents one.
 */
export function QuickAddSheet({
  onClose,
  onLogged,
  onOpenFood,
  onSteer,
}: {
  onClose: () => void;
  onLogged: () => void;
  /** The meal row's door — the food module's Log screen. Row hidden when the host has no door. */
  onOpenFood?: () => void;
  /** Screen 2's "Tell me instead" — hands a seed sentence to the coach. Wired at the shell
   *  (MainTabs) the same way PlanView's `onSteerCoach` is; the row hides itself without it. */
  onSteer?: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false); // the free line's in-flight guard
  const [text, setText] = useState('');
  /** At most one row expanded at a time — a sheet of open forms is a form, not a quick add. */
  const [open, setOpen] = useState<'weight' | null>(null);
  /** Screen 1 → screen 2 (Activity Builder 2A): set by tapping a movement/practice noun row,
   *  cleared by its back affordance. Replaces the whole sheet body while it's set — the coach's
   *  present-tense menu and the free line belong to screen 1, not the noun's own screen. */
  const [screen, setScreen] = useState<TenseScreen | null>(null);

  /**
   * A failed plan read is UNKNOWN, never an empty plan (the 2026-08-19 rule): `usePlan` throws on
   * failure, so the error branch below can say "couldn't reach" while the free line keeps working.
   */
  const { data: plan, error } = usePlan();
  const { data: day } = useNutritionDay();
  const [photosEnabled, setPhotosEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void getProgressPhotosStatus().then((s) => {
      if (alive) setPhotosEnabled(s.enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function freeLog() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    await logAdhoc(t).catch(() => {});
    onLogged();
    onClose();
  }

  const planLoading = plan === undefined && !error;
  const rows = deriveQuickAddRows({ plan: plan ?? null, day: day ?? null, photosEnabled });

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet ld" role="dialog" aria-label="Quick add">
        <div className="sheet-grab" aria-hidden />

        {screen ? (
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
          />
        ) : (
          <>
            {/* Present tense first — the past is patient. Renders nothing at all when the coach
                has nothing to offer, so the quick-add section simply sits where it always did. */}
            <DoNowSection onClose={onClose} onLogged={onLogged} />
            <div className="ld-split" aria-hidden />

            <div className="ld-head">
              <b>Quick add</b>
              <span>Log what just happened — it counts, scheduled or not.</span>
            </div>

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
          </>
        )}
      </div>
    </>
  );
}
