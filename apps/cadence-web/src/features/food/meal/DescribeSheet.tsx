/**
 * "What did you have?" — the pencil door, and the voice door with the mic already live (canvas
 * "Cadence Quick Log" 1a, 2026-10-29). A sheet over the drawer, not a screen of its own: the
 * shelves and the cart stay underneath, and closing it lands back on them.
 *
 * The words go to the same parse-and-price lookup the chat door used (`previewMeal` → the
 * `parse-meal` job, through AI Admin). What comes back is listed, one row a food — name, P/C/F,
 * the amount, kcal, × to drop a row — and nothing enters the meal until "Looks right". An amount
 * nobody said is shown as a question, and it waits as a chip on the drawer the way it always has
 * (draft mode: one unsettled amount holds the log, never the add).
 */
import { useState } from 'react';
import { previewMeal, type MealKind, type MealPreview } from '../../../lib/api.ts';
import { CoachFace } from '../../../components/CoachFace.tsx';
import { GrowingTextarea } from '../../../components/GrowingTextarea.tsx';
import { MicButton } from '../../../components/MicButton.tsx';
import { fmtKcal } from '../bracket/copy.ts';
import { READING } from '../LogByChat.tsx';
import { amountWords } from './amountWords.ts';
import { macroLine } from './macroLine.ts';

type Row = MealPreview['items'][number];

export function DescribeSheet({
  meal,
  seed = '',
  listening = false,
  busy,
  onAdd,
  onClose,
}: {
  meal: MealKind;
  /** Words already typed elsewhere — the filter bar's "Tell the coach" hands its phrase over. */
  seed?: string;
  listening?: boolean;
  busy?: boolean;
  /** Append the rows verbatim into the open meal; resolves false when it did not land. */
  onAdd: (items: Row[], rawText: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState(seed);
  const [read, setRead] = useState<{ for: string; rows: Row[] } | null>(null);
  const [looking, setLooking] = useState(false);
  const [err, setErr] = useState('');

  const words = text.trim();
  const fresh = read && read.for === words ? read.rows : null;
  const kcal = (fresh ?? []).reduce((s, r) => s + (r.est?.kcal ?? 0), 0);

  async function lookUp() {
    if (!words || looking) return;
    setLooking(true);
    setErr('');
    try {
      const p = await previewMeal(words, meal);
      if (!p.items.length) setErr("I couldn't pick anything out of that — try naming the foods.");
      setRead({ for: words, rows: p.items });
    } catch {
      setErr("Couldn't look that up just now — try again in a moment.");
    } finally {
      setLooking(false);
    }
  }

  async function confirm() {
    if (!fresh?.length || busy) return;
    if (await onAdd(fresh, words)) onClose();
  }

  const drop = (i: number) => setRead((r) => (r ? { ...r, rows: r.rows.filter((_, j) => j !== i) } : r));
  const ready = !!fresh?.length;
  const label = looking ? READING : ready ? `Looks right · ${fmtKcal(kcal)} kcal` : 'Look it up';

  return (
    <>
      <div className="ms-ds-scrim" aria-hidden onClick={onClose} />
      <div className="ms-ds" role="dialog" aria-label="What did you have?">
        <div className="ms-grab" aria-hidden="true" />
        <div className="ms-ds-head">
          <h2>What did you have?</h2>
          <button type="button" className="ms-ds-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ms-ds-box">
          <GrowingTextarea
            value={text}
            onChange={setText}
            disabled={looking}
            maxRows={6}
            ariaLabel="What did you have?"
            placeholder="2 eggs on sourdough, flat white with oat milk…"
            onSubmit={() => void (ready ? confirm() : lookUp())}
          />
        </div>
        {fresh && fresh.length > 0 && (
          <div className="ms-ds-found">
            <div className="ms-ds-found-h">
              <CoachFace size={22} />
              <span>Here&apos;s what I found</span>
            </div>
            {fresh.map((r, i) => (
              <div className="ms-ds-row" key={`${r.name}-${i}`}>
                <div className="ms-ds-row-w">
                  <div className="ms-ds-row-n">{r.brand ? `${r.brand} ${r.name}` : r.name}</div>
                  {macroLine(r.est) && <div className="ms-ds-row-m">{macroLine(r.est)}</div>}
                </div>
                <span className={`ms-ds-amt${r.qty == null ? ' is-ask' : ''}`}>{amountWords(r)}</span>
                <span className="ms-ds-k">
                  <b>{fmtKcal(r.est?.kcal)}</b>
                  <i>KCAL</i>
                </span>
                <button type="button" className="ms-ds-drop" aria-label={`Drop ${r.name}`} onClick={() => drop(i)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {err && <div className="food-empty ms-err">{err}</div>}
        <div className="ms-ds-foot">
          <MicButton value={text} onChange={setText} disabled={looking} autoStart={listening} />
          <button
            type="button"
            className={`ms-ds-go${ready ? ' is-ready' : ''}`}
            disabled={!words || looking || busy}
            onClick={() => void (ready ? confirm() : lookUp())}
          >
            {label}
          </button>
        </div>
      </div>
    </>
  );
}
