/**
 * S4 — "Two added" / the retroactive tidy (canvas frame S4; MEAL-LOGGING.md "Retro tidy").
 *
 * First what saved (the ✓ cookbook card), then the opt-in offer to re-read the week behind you:
 * flat rows become the bracket, the numbers stay exactly what they were, and days with an extra
 * keep it loose outside the mark. The NOW → AFTER diagram is a static illustration drawn from the
 * first offered proposal's members. After a tidy, reversibility is visible on-surface — one quiet
 * "Tidied · Undo" line that calls the revert while the sheet is still open, never a buried setting.
 */
import type { Recipe } from '@cadence/shared';
import { numberWordCap } from '../bracket/copy.ts';
import { CoachLine } from './CoachLine.tsx';
import { EXTRAS_FOOTNOTE, numbersLine, tidyBubble, tidyButtonLabel, type TidyableProposal } from './copy.ts';
import type { FoodSweepPhase } from './useFoodSweep.ts';

export interface FoodSweepTidyProps {
  /** What the commit saved — the ✓ list. */
  saved: Recipe[];
  /** Accepted proposals with tidy.log_count > 0 — the only ones the offer speaks about. */
  tidyable: TidyableProposal[];
  phase: Extract<FoodSweepPhase, 'tidyOffer' | 'tidying' | 'done' | 'reverted'>;
  /** How many meals the tidy re-read (0 until one runs). */
  tidiedCount: number;
  error?: string | null;
  /** "Tidy the five breakfasts" — the hook owns the ids. */
  onTidy: () => void;
  /** "Leave the past alone" (and the lone "Done" when nothing is tidyable). Host closes. */
  onSkip: () => void;
  /** The quiet line's Undo — revertFoodTidy while the sheet is still open. */
  onUndo: () => void;
  /** The ‹ and the scrim. */
  onClose: () => void;
}

function TidyDiagram({ first, tidyable }: { first: TidyableProposal; tidyable: TidyableProposal[] }) {
  const butter = first.proposal.yield_servings > 1;
  return (
    <div className="sw-diagram">
      <div className="sw-label">WHAT WOULD CHANGE</div>
      <div className="sw-dg-row">
        <div className="sw-dg-panel">
          <div className="sw-dg-tag">NOW</div>
          <div className="sw-dg-flat">
            {first.proposal.members.map((m) => (
              <div key={m.food_id}>{m.name}</div>
            ))}
            <div className="sw-dg-extra">an extra, some days</div>
          </div>
        </div>
        <div className="sw-dg-arrow" aria-hidden>
          {'→'}
        </div>
        <div className="sw-dg-panel sw-dg-panel--after">
          <div className="sw-dg-tag sw-dg-tag--after">AFTER</div>
          <div className={`sw-dg-bracket${butter ? ' sw-dg-bracket--butter' : ''}`}>
            <span className="sw-rail" aria-hidden />
            <div>
              <div className="sw-dg-name">{first.proposal.name}</div>
              <div className="sw-dg-things">{`${first.proposal.members.length} things`}</div>
            </div>
          </div>
          <div className="sw-dg-extra">the extra, still loose</div>
        </div>
      </div>
      <div className="sw-numbers">{numbersLine(tidyable)}</div>
    </div>
  );
}

export function FoodSweepTidy({
  saved,
  tidyable,
  phase,
  tidiedCount,
  error,
  onTidy,
  onSkip,
  onUndo,
  onClose,
}: FoodSweepTidyProps) {
  const first = tidyable[0];
  const offering = phase === 'tidyOffer' || phase === 'tidying';
  const title = `${numberWordCap(saved.length)} added`;
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet sw-sheet" role="dialog" aria-label={title}>
        <div className="sheet-grab" aria-hidden />
        <div className="sw-head">
          <button type="button" className="sw-back" aria-label="Close" onClick={onClose}>
            {'‹'}
          </button>
          <div className="sw-title">{title}</div>
        </div>
        <div className="sw-body">
          <div className="sw-cookbook">
            <div className="sw-cb-head">
              <span className="sw-check" aria-hidden>
                {'✓'}
              </span>
              <span>In your cookbook</span>
            </div>
            {saved.map((r) => (
              <div key={r.recipe_id} className="sw-cb-row">
                <span className={`sw-cb-rail${r.servings > 1 ? ' sw-cb-rail--butter' : ''}`} aria-hidden />
                <span className="sw-cb-name">{r.name}</span>
                <span className="sw-cb-kind">{r.servings > 1 ? `makes ${r.servings}` : 'a meal'}</span>
              </div>
            ))}
          </div>
          {offering && first && (
            <>
              <CoachLine text={tidyBubble(tidyable)} />
              <TidyDiagram first={first} tidyable={tidyable} />
              <div className="sw-foot">{EXTRAS_FOOTNOTE}</div>
            </>
          )}
          {phase === 'done' && tidiedCount > 0 && (
            <div className="sw-quiet">
              <span>Tidied</span>
              <span aria-hidden>{' · '}</span>
              <button type="button" className="sw-undo" onClick={onUndo}>
                Undo
              </button>
            </div>
          )}
          {phase === 'reverted' && <div className="sw-quiet">Put back as it was.</div>}
          {error && <div className="sw-err">{error}</div>}
        </div>
        {offering && (
          <div className="sw-actions">
            {first ? (
              <>
                <button
                  type="button"
                  className="sw-primary sw-primary--tidy"
                  disabled={phase === 'tidying'}
                  onClick={onTidy}
                >
                  {tidyButtonLabel(tidyable)}
                </button>
                <button type="button" className="sw-secondary" disabled={phase === 'tidying'} onClick={onSkip}>
                  Leave the past alone
                </button>
              </>
            ) : (
              <button type="button" className="sw-secondary" onClick={onSkip}>
                Done
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
