import { useState } from 'react';
import { macrosForLog } from '@cadence/shared';
import { MicButton } from '../../../components/MicButton.tsx';
import { FoodBarcodePanel } from '../../food/FoodBarcodePanel.tsx';
import type { MealMacros, OccurrenceDetail } from '../../../lib/api.ts';
import { NutritionRing } from '../../nutrition/NutritionRing.tsx';
import { MealParseCard } from '../../food/MealParseCard.tsx';
import { MealDraftCard } from './MealDraftCard.tsx';
import { useMealCapture, type PlateEntry } from './useMealCapture.ts';
import type { MealPreview } from '../../../lib/api.ts';
import { usePlannedMeal } from './usePlannedMeal.ts';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Sum a plate's items into one macro total (client-side preview; the server recomputes on log). */
function sumPlate(plate: PlateEntry[]): MealMacros {
  const total: MealMacros = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const e of plate) {
    const m = macrosForLog(e.food, { servingIndex: e.servingIndex, quantity: e.quantity });
    total.kcal = (total.kcal ?? 0) + (m.kcal ?? 0);
    total.protein_g = (total.protein_g ?? 0) + (m.protein_g ?? 0);
    total.carbs_g = (total.carbs_g ?? 0) + (m.carbs_g ?? 0);
    total.fat_g = (total.fat_g ?? 0) + (m.fat_g ?? 0);
  }
  return total;
}

/** The plate's item rows (design 2D) — each a thumb-less line with name, a ±0.25 stepper, and macros. */
function PlateList({
  plate,
  busy,
  onQty,
  onRemove,
}: {
  plate: PlateEntry[];
  busy: boolean;
  onQty: (i: number, q: number) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="mc-platelist">
      {plate.map((e, i) => {
        const m = macrosForLog(e.food, { servingIndex: e.servingIndex, quantity: e.quantity });
        const sub = [
          e.food.servings[e.servingIndex]?.label,
          m.kcal ? `${Math.round(m.kcal)} kcal` : '',
          m.protein_g ? `P${Math.round(m.protein_g)}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div className="mc-item" key={`${e.food.food_id}-${i}`}>
            <div className="mc-item-t">
              <b>{e.food.name}</b>
              <span>{sub}</span>
            </div>
            <div className="mc-item-q">
              <button
                type="button"
                className="mc-istep"
                aria-label="Less"
                disabled={busy || e.quantity <= 0.25}
                onClick={() => onQty(i, Math.max(0.25, round2(e.quantity - 0.25)))}
              >
                −
              </button>
              <b>{e.quantity}</b>
              <button
                type="button"
                className="mc-istep"
                aria-label="More"
                disabled={busy}
                onClick={() => onQty(i, round2(e.quantity + 0.25))}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="mc-item-x"
              aria-label={`Remove ${e.food.name}`}
              disabled={busy}
              onClick={() => onRemove(i)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden>
    <path
      d="M4 8.5h3l1.2-2h5.6L15 8.5h3a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 18 18.5H4A1.5 1.5 0 0 1 2.5 17v-7A1.5 1.5 0 0 1 4 8.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <circle cx="11" cy="13" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
const ScanIcon = () => (
  <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden>
    <path
      d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path d="M7.5 8.5v7M10 8.5v7M13 8.5v7M16.5 8.5v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

/**
 * The redesigned meal capture — a *capture*, never a walkthrough. Today's two-tone rings sit in
 * context (logged solid, this-meal pale, free grey), four honest routes to say what you had, the
 * resolver's draft card with real quantities, and two-tap recents. A photo can ask "want a read
 * before you eat?" first. One confirm writes the meal, ticks the task, and closes the sheet.
 */
export function MealCapturePanel({
  detail,
  setDetail,
  onLogged,
  onClose,
  onOpenFood,
}: {
  detail: OccurrenceDetail;
  setDetail: (d: OccurrenceDetail) => void;
  onLogged?: () => void;
  onClose?: () => void;
  /** Leave the capture for the Food screen — the day's whole read, and the way into Nutrients. */
  onOpenFood?: () => void;
}) {
  const cap = useMealCapture(detail, setDetail, { onLogged, onClose });
  const { planned, alsoThisWeek } = usePlannedMeal(cap.mealKind, detail.date);
  const [text, setText] = useState('');
  const [route, setRoute] = useState<'idle' | 'scan'>('idle');
  /** Set while the composer is collecting ANOTHER thing for a meal already on the card. */
  const [addingTo, setAddingTo] = useState<MealPreview | null>(null);
  const [pending, setPending] = useState<MealMacros | null>(null);

  const day = cap.day;
  const target = day?.targets ?? null;
  const eaten = day?.totals ?? {};
  const eatenKcal = eaten.kcal ?? 0;
  const targetKcal = target?.kcal ?? null;
  const plateMacros = sumPlate(cap.plate);
  const alreadyLogged = (day?.meals ?? []).filter((m) => m.meal === cap.mealKind);
  const pendingKcal = (plateMacros.kcal ?? 0) + (pending?.kcal ?? 0);
  const leftAfter = targetKcal != null ? targetKcal - eatenKcal - pendingKcal : null;

  const macroBars: Array<{ key: 'protein_g' | 'carbs_g' | 'fat_g'; label: string; color: string }> = [
    { key: 'protein_g', label: 'PROTEIN', color: 'oklch(52% 0.09 152)' },
    { key: 'carbs_g', label: 'CARBS', color: 'oklch(62% 0.08 250)' },
    { key: 'fat_g', label: 'FAT', color: 'oklch(64% 0.14 268)' },
  ];

  function onPhoto(file: File | undefined) {
    void cap.pickPhoto(file);
  }

  const ring = (
    <NutritionRing
      logged={eatenKcal}
      pending={pendingKcal}
      target={targetKcal}
      size={74}
      stroke={13}
      className="mc-ring"
    >
      {pendingKcal > 0 && leftAfter != null ? (
        <>
          <b>{fmt(Math.abs(leftAfter))}</b>
          <span>{leftAfter < 0 ? 'KCAL OVER' : 'LEFT AFTER THIS'}</span>
        </>
      ) : targetKcal != null ? (
        <>
          <b>{fmt(eatenKcal)}</b>
          <span>OF {fmt(targetKcal)}</span>
        </>
      ) : (
        <>
          <b>{fmt(eatenKcal)}</b>
          <span>SO FAR</span>
        </>
      )}
    </NutritionRing>
  );

  return (
    <div className="mc">
      {/* Rings strip — logged / this-meal / free, all recomputing as the portion changes.
          The ring is also the door out to the whole day: a capture answers "what did I just eat",
          and the question it raises next ("so where does that leave me") lives in the Food screen,
          which had no way in from here (owner device report, 2026-08-20). */}
      <div className="mc-rings">
        {onOpenFood ? (
          <button type="button" className="mc-ringbtn" onClick={onOpenFood} aria-label="Open your whole day in Food">
            {ring}
          </button>
        ) : (
          ring
        )}
        <div className="mc-rings-r">
          <div className="mc-left">
            {targetKcal != null
              ? `${fmt(Math.max(0, targetKcal - eatenKcal))} kcal left today`
              : `${fmt(eatenKcal)} kcal so far`}
          </div>
          <div className="mc-bars">
            {macroBars.map((b) => {
              const e = eaten[b.key] ?? 0;
              const t = target?.[b.key] ?? null;
              const pct = t && t > 0 ? Math.min(100, (e / t) * 100) : 0;
              return (
                <div className="mc-bar" key={b.key}>
                  <span className="mc-bar-l">{b.label}</span>
                  <div className="mc-bar-track">
                    <div className="mc-bar-fill" style={{ width: `${pct}%`, background: b.color }} />
                  </div>
                  <span className="mc-bar-v">
                    {Math.round(e)}
                    {t != null ? ` / ${Math.round(t)}g` : 'g'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {cap.plate.length > 0 && (
        <PlateList plate={cap.plate} busy={cap.busy} onQty={cap.setPlateQty} onRemove={cap.removePlateItem} />
      )}

      {cap.mealPreview ? (
        <MealParseCard
          preview={cap.mealPreview}
          initialMeal={cap.mealKind}
          onLogged={() => {
            cap.setMealPreview(null);
            setText('');
            cap.markLogged();
          }}
          onNotAMeal={() => {
            const words = cap.mealPreview?.raw_text ?? text;
            cap.setMealPreview(null);
            void cap.resolveText(words, { forceSingle: true });
          }}
          onCancel={() => cap.setMealPreview(null)}
          onAskRead={() => void cap.checkPlate(cap.mealPreview?.raw_text)}
          onAddAnother={() => {
            setAddingTo(cap.mealPreview);
            cap.setMealPreview(null);
            setText('');
          }}
          advice={cap.plateAdvice}
          advising={cap.advising}
        />
      ) : cap.draft ? (
        <MealDraftCard
          draft={cap.draft}
          meal={cap.mealKind}
          busy={cap.busy}
          err={cap.logErr}
          plateMode={cap.plate.length > 0}
          onMacros={setPending}
          onLog={cap.logDraft}
          onAddAnother={(portion) => {
            setPending(null);
            void cap.addToPlate(portion);
          }}
          onBack={() => {
            setPending(null);
            cap.setDraft(null);
          }}
        />
      ) : cap.photo ? (
        <div className="mc-photo">
          <div className="mc-photo-prev">
            <img src={cap.photo} alt="your plate" />
            <button className="mc-photo-x" onClick={cap.clearPhoto} disabled={cap.busy} aria-label="Remove photo">
              ×
            </button>
          </div>
          {cap.plateAdvice ? (
            <div className={`mc-plate pa-${cap.plateAdvice.verdict}`}>
              <div className="mc-plate-k">A READ, NOT A RULING</div>
              <div className="mc-plate-a">{cap.plateAdvice.advice}</div>
              {cap.plateAdvice.estimate_kcal != null && (
                <div className="mc-plate-e">~{cap.plateAdvice.estimate_kcal} kcal est.</div>
              )}
            </div>
          ) : (
            <button className="mc-plate-ask" onClick={() => void cap.checkPlate()} disabled={cap.advising}>
              {cap.advising ? 'Looking at your plate…' : 'Want a read before you eat? ›'}
            </button>
          )}
          <input
            className="mc-cap-in"
            value={text}
            placeholder="a few words help — “chicken burrito bowl”"
            disabled={cap.busy}
            onChange={(e) => setText(e.target.value)}
          />
          {cap.logErr && <div className="mc-err">{cap.logErr}</div>}
          <button className="mc-log" disabled={cap.busy} onClick={() => cap.logPhoto(text)}>
            {cap.busy ? 'Writing it down…' : `Log ${cap.mealKind}`}
          </button>
        </div>
      ) : (
        <>
          {/* Already on this meal today. Someone who comes back to add a latte should SEE that
              breakfast is already there and that they are adding to it, not wonder whether the
              second tap did anything (owner, 2026-08-15 — "I added it by tapping the breakfast
              button a second time… it's not showing"). */}
          {alreadyLogged.length > 0 && (
            <div className="mc-already">
              <div className="mc-already-k">ALREADY ON THIS {cap.mealKind.toUpperCase()}</div>
              {alreadyLogged.map((m) => (
                <div className="mc-already-row" key={m.log_id}>
                  <span>{m.items.map((i) => i.name).join(', ') || m.raw_text || 'logged'}</span>
                  {m.macros?.kcal != null && <b>~{Math.round(m.macros.kcal)} kcal</b>}
                </div>
              ))}
              <div className="mc-already-s">Anything you add now joins it.</div>
            </div>
          )}

          {cap.plate.length === 0 && (planned || alsoThisWeek.length > 0) && (
            <div className="mc-planned">
              {planned && (
                <button
                  className="mc-plan-row is-planned"
                  disabled={cap.busy}
                  onClick={() => void cap.logRecipe(planned.recipe_id)}
                >
                  <div className="mc-plan-t">
                    <b>{planned.name}</b>
                    <span>PLANNED · ATE IT — ONE TAP</span>
                  </div>
                  <span className="mc-plan-go" aria-hidden>
                    ›
                  </span>
                </button>
              )}
              {alsoThisWeek.map((m) => (
                <button
                  key={m.recipe_id}
                  className="mc-plan-row"
                  disabled={cap.busy}
                  onClick={() => void cap.logRecipe(m.recipe_id)}
                >
                  <div className="mc-plan-t">
                    <b>{m.name}</b>
                    <span>also on your week</span>
                  </div>
                  <span className="mc-plan-go" aria-hidden>
                    ›
                  </span>
                </button>
              ))}
            </div>
          )}
          {/* The composer is ALWAYS here — typing is the default, the mic lives inside the box,
              and nothing toggles between them. There used to be separate "Say" and "Type" tiles
              that opened the identical field, which read as a mode switch that changed nothing
              (owner, 2026-08-15). Say IS type with the mic pressed. */}
          <div className="mc-say">
            {addingTo && (
              <div className="mc-adding">
                Adding to this {cap.mealKind} — {addingTo.items.length} thing
                {addingTo.items.length === 1 ? '' : 's'} so far
              </div>
            )}
            <div className="mc-say-row">
              <textarea
                className="mc-cap-in"
                value={text}
                rows={2}
                disabled={cap.resolving}
                placeholder='What did you have? — "1 cup strawberries, 2/3 cup skyr, 1 scoop protein"'
                onChange={(e) => setText(e.target.value)}
              />
              <MicButton value={text} onChange={setText} disabled={cap.resolving} />
            </div>
            {text.trim() && (
              <button className="mc-log" disabled={cap.resolving} onClick={() => void cap.resolveText(text)}>
                {cap.resolving ? 'Reading it…' : 'Log it — I confirm next'}
              </button>
            )}
          </div>

          <div className="mc-routes">
            <label className="mc-route mc-route-tone">
              <span className="mc-route-i">
                <CameraIcon />
              </span>
              <span className="mc-route-l">Snap</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  onPhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <button className="mc-route" onClick={() => setRoute(route === 'scan' ? 'idle' : 'scan')}>
              <span className="mc-route-i">
                <ScanIcon />
              </span>
              <span className="mc-route-l">Scan</span>
            </button>
          </div>

          {route === 'scan' && (
            <div className="mc-scan">
              <FoodBarcodePanel
                onDraft={(d) => {
                  cap.setDraft(d);
                  setRoute('idle');
                }}
                onCancel={() => setRoute('idle')}
              />
            </div>
          )}

          {cap.note && <div className="mc-note">{cap.note}</div>}

          {cap.recentsStatus === 'ok' && cap.recents.length > 0 && (
            <div className="mc-recents">
              <div className="mc-recents-l">OR TWO TAPS</div>
              <div className="mc-recents-row">
                {cap.recents.map((f) => (
                  <button
                    key={f.food_id}
                    className="mc-pill"
                    disabled={cap.busy}
                    onClick={() => void cap.pickSaved(f.food_id)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {cap.plate.length > 0 && (
            <div className="mc-plate-foot">
              <div className="mc-plate-tot">
                <b>~{fmt(plateMacros.kcal ?? 0)} kcal</b>
                <span>
                  P{Math.round(plateMacros.protein_g ?? 0)} · C{Math.round(plateMacros.carbs_g ?? 0)} · F
                  {Math.round(plateMacros.fat_g ?? 0)}
                </span>
              </div>
              {cap.logErr && <div className="mc-err">{cap.logErr}</div>}
              <button className="mc-log" disabled={cap.busy} onClick={() => void cap.logPlate()}>
                {cap.busy
                  ? 'Writing it down…'
                  : `Log ${cap.mealKind} · ${cap.plate.length} thing${cap.plate.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
