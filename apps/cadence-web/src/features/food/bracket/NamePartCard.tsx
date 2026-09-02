/**
 * "What do you call this?" — naming and yield, one card (docs/cadence/MEAL-LOGGING.md: naming is
 * skippable, the suggested chips are the user's own words, and the word "recipe" appears only in
 * the save subtitles the canvas itself writes). Two variants:
 *
 *   • `name` — after a bracket is made: name input + chips, then the portions question verbatim
 *     from canvas C3 ("HOW MANY PORTIONS DID IT MAKE?", "Just this one" the default);
 *   • `offer` — B3's on-the-spot offer after several quick adds: a preview of the mark, not a
 *     dialog ("Four things, one after another. Do they go together?").
 *
 * Callbacks only. `onName`/`onYield` report every change; `onSave`/`onCancel` are the two doors.
 */
import { useState } from 'react';
import type { Macros } from '@cadence/shared';
import { fmtKcal, macroLine, numberWord, numberWordCap } from './copy.ts';

export interface NamePartCardProps {
  variant?: 'name' | 'offer';
  /** How many things the bracket holds. */
  count: number;
  /** The bracket's summed macros — display only, never recomputed here. */
  est?: Macros;
  /** Suggestion chips, the user's own words first. The caller supplies them. */
  chips: string[];
  /** Offer variant: the member names, shortened by the caller ("yogurt · chia · whey"). */
  previewNames?: string[];
  initialName?: string;
  onName: (name: string | null) => void;
  onYield: (servings: number) => void;
  onSave: () => void;
  onCancel: () => void;
}

function totalLine(count: number, est?: Macros): string {
  const macros = macroLine(est);
  return [`${fmtKcal(est?.kcal)} kcal`, macros].filter(Boolean).join(' · ');
}

function LeafGlyph() {
  return (
    <span className="mb-coach-dot" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24">
        <path d="M12 3c5 1 8 4 8 9 0 5-4 9-9 9-1.5 0-3-.4-4-1 4-1 7-4 8-9-2 3-5 5-8 5 2-6 5-11 5-13z" fill="white" />
      </svg>
    </span>
  );
}

export function NamePartCard(props: NamePartCardProps) {
  const { variant = 'name', count, est, chips, previewNames, onName, onYield } = props;
  const [name, setName] = useState(props.initialName ?? '');
  const [several, setSeveral] = useState(false);
  const [servings, setServings] = useState(4);

  const setNameAnd = (value: string) => {
    setName(value);
    onName(value.trim() ? value.trim() : null);
  };
  const chooseOne = () => {
    setSeveral(false);
    onYield(1);
  };
  const chooseSeveral = (n = servings) => {
    setSeveral(true);
    setServings(n);
    onYield(n);
  };

  const nameField = (
    <>
      <input
        className="mb-name-input"
        type="text"
        value={name}
        placeholder="What do you call this?"
        aria-label="What do you call this?"
        onChange={(e) => setNameAnd(e.target.value)}
      />
      <div className="mb-chips">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            className={`mb-chip${name === chip ? ' mb-chip--on' : ''}`}
            onClick={() => setNameAnd(chip)}
          >
            {chip}
          </button>
        ))}
      </div>
    </>
  );

  if (variant === 'offer') {
    return (
      <div className="mb-name-card mb-name-card--offer">
        <div className="mb-offer-line">
          <LeafGlyph />
          <span>{`${numberWordCap(count)} things, one after another. Do they go together?`}</span>
        </div>
        <div className="mb-offer-preview">
          <div className="mb-rail mb-rail--head" />
          <div className="mb-offer-words">
            <div className="mb-offer-title">{`These ${numberWord(count)}, as one thing`}</div>
            <div className="mb-offer-sub">
              {previewNames && previewNames.length > 0 && (
                <>
                  {previewNames.join(' · ')}
                  <br />
                </>
              )}
              {totalLine(count, est)}
            </div>
          </div>
        </div>
        {nameField}
        <div className="mb-btn-row">
          <button type="button" className="mb-amber-btn" onClick={props.onSave}>
            Yes, together
          </button>
          <button type="button" className="mb-quiet-btn mb-quiet-btn--snug" onClick={props.onCancel}>
            Leave them
          </button>
        </div>
        <div className="mb-footnote">
          {"Leave them and nothing is lost — I'll ask again on Sunday if it keeps happening."}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-name-card">
      <div className="mb-sheet-head">
        <div className="mb-rail mb-rail--head" />
        <div className="mb-sheet-words">
          <div className="mb-sheet-title">{`${numberWordCap(count)} things together`}</div>
          <div className="mb-sheet-sub">{totalLine(count, est)}</div>
        </div>
      </div>
      {nameField}
      <div className="mb-footnote">{"Skip the name if you'd rather."}</div>
      <div className="mb-yield">
        <div className="mb-yield-label">HOW MANY PORTIONS DID IT MAKE?</div>
        <div className={`mb-option${!several ? ' mb-option--on' : ''}`}>
          <button type="button" className="mb-option-main" aria-pressed={!several} onClick={chooseOne}>
            <span className={`mb-tick mb-tick--small${!several ? ' mb-tick--on' : ''}`} aria-hidden="true">
              {!several ? '✓' : ''}
            </span>
            <span className="mb-option-words">
              <span className="mb-option-title">Just this one</span>
              <span className="mb-option-sub">
                {'Saves as a '}
                <strong>meal</strong>
                {' — tap it, it logs exactly this'}
              </span>
            </span>
          </button>
        </div>
        <div className={`mb-option${several ? ' mb-option--on' : ''}`}>
          <button type="button" className="mb-option-main" aria-pressed={several} onClick={() => chooseSeveral()}>
            <span className={`mb-tick mb-tick--small${several ? ' mb-tick--on' : ''}`} aria-hidden="true">
              {several ? '✓' : ''}
            </span>
            <span className="mb-option-words">
              <span className="mb-option-title">It made several</span>
              <span className="mb-option-sub">
                {'Saves as a '}
                <strong>recipe</strong>
                {' — per-serving numbers, a shopping list'}
              </span>
            </span>
          </button>
          <span className="mb-stepper">
            <button
              type="button"
              className="mb-step"
              aria-label="Fewer portions"
              disabled={!several || servings <= 2}
              onClick={() => chooseSeveral(Math.max(2, servings - 1))}
            >
              −
            </button>
            <span className="mb-step-n">{servings}</span>
            <button
              type="button"
              className="mb-step"
              aria-label="More portions"
              disabled={!several}
              onClick={() => chooseSeveral(servings + 1)}
            >
              ＋
            </button>
          </span>
        </div>
      </div>
      <div className="mb-btn-row">
        <button type="button" className="mb-amber-btn" onClick={props.onSave}>
          Save it
        </button>
        <button type="button" className="mb-quiet-btn mb-quiet-btn--snug" onClick={props.onCancel}>
          No thanks
        </button>
      </div>
    </div>
  );
}
