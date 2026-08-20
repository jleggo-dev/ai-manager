import { useState } from 'react';
import type { MealMacros, MealPreview, OccurrenceDetail } from '../../../lib/api.ts';
import { LogScreen } from '../../food/LogScreen.tsx';
import { MealParseCard } from '../../food/MealParseCard.tsx';
import { useUsualAtSlot } from '../../food/useUsualAtSlot.ts';
import type { CaptureMethod } from '../../food/MethodTiles.tsx';
import { MealCapturePhoto } from './MealCapturePhoto.tsx';
import { MealCaptureRings } from './MealCaptureRings.tsx';
import { MealDraftCard } from './MealDraftCard.tsx';
import { MealPlateList } from './MealPlateList.tsx';
import { QuickAddBody } from './QuickAddBody.tsx';
import { fmtKcal, sumPlate } from './mealPlate.ts';
import { useMealCapture } from './useMealCapture.ts';
import { usePlannedMeal } from './usePlannedMeal.ts';

/**
 * The meal capture, from the trail — a *capture*, never a walkthrough. Today's two-tone rings sit
 * in context, and under them **quick add, scoped to this slot** (design 05a): what the week
 * planned for it, then what they usually have at it, counted. Every method is a tile, so nothing
 * here is a dead end — each one opens the full Log screen (05b), which needs no trail task at all.
 *
 * One confirm writes the meal, ticks the task, and closes the sheet. Nothing counts before it.
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
  const { planned } = usePlannedMeal(cap.mealKind, detail.date);
  const usual = useUsualAtSlot(cap.mealKind);
  const [text, setText] = useState('');
  /** Set while the composer is collecting ANOTHER thing for a meal already on the card. */
  const [addingTo, setAddingTo] = useState<MealPreview | null>(null);
  const [pending, setPending] = useState<MealMacros | null>(null);
  /** The full Log screen, opened over the sheet by a method tile. */
  const [logOpen, setLogOpen] = useState<CaptureMethod | null>(null);

  const day = cap.day;
  const eaten = day?.totals ?? {};
  const plateMacros = sumPlate(cap.plate);
  const alreadyLogged = (day?.meals ?? []).filter((m) => m.meal === cap.mealKind);
  const pendingKcal = (plateMacros.kcal ?? 0) + (pending?.kcal ?? 0);

  if (logOpen) {
    return (
      <LogScreen
        date={detail.date}
        initialMeal={cap.mealKind}
        // The tile they already tapped — without this the Log screen opened on its own tile row
        // and asked them to choose the same method a second time.
        initialMethod={logOpen}
        onClose={() => setLogOpen(null)}
        onLogged={() => cap.markLogged()}
      />
    );
  }

  return (
    <div className="mc">
      {/* Slice 2 extracted these rings; slice 3 made the ring the door out to the whole day. Both
          survive: the component owns the layout, and `onOpenFood` carries the door through it. */}
      <MealCaptureRings
        eaten={eaten}
        target={day?.targets ?? null}
        pendingKcal={pendingKcal}
        {...(onOpenFood ? { onOpenFood } : {})}
      />

      {cap.plate.length > 0 && (
        <MealPlateList plate={cap.plate} busy={cap.busy} onQty={cap.setPlateQty} onRemove={cap.removePlateItem} />
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
        <MealCapturePhoto
          photo={cap.photo}
          caption={text}
          setCaption={setText}
          mealKind={cap.mealKind}
          busy={cap.busy}
          advising={cap.advising}
          advice={cap.plateAdvice}
          logErr={cap.logErr}
          onClear={cap.clearPhoto}
          onAskRead={() => void cap.checkPlate()}
          onLog={() => void cap.logPhoto(text)}
        />
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

          {addingTo && (
            <div className="mc-adding">
              Adding to this {cap.mealKind} — {addingTo.items.length} thing
              {addingTo.items.length === 1 ? '' : 's'} so far
            </div>
          )}

          <QuickAddBody
            mealKind={cap.mealKind}
            planned={planned}
            usual={usual}
            busy={cap.busy}
            onMethod={setLogOpen}
            onPhoto={(file) => void cap.pickPhoto(file)}
            onLogRecipe={(id) => void cap.logRecipe(id)}
            onAddFood={(id) => void cap.pickSaved(id)}
          />

          {cap.note && <div className="mc-note">{cap.note}</div>}

          {cap.plate.length > 0 && (
            <div className="mc-plate-foot">
              <div className="mc-plate-tot">
                <b>~{fmtKcal(plateMacros.kcal ?? 0)} kcal</b>
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
