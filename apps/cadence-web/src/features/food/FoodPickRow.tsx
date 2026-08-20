import type { ReactNode } from 'react';

/**
 * One addable line — name, the honest sub-line under it, its calories, and a ＋. The same row
 * serves the quick-add sheet (05a) and the full Log screen (05b), so what a planned meal looks
 * like and what a food you eat every week looks like never drift apart.
 *
 * The ＋ is its own control when `onOpen` is given. In the design it is a button on the row, not a
 * decoration on one — "RECENTLY EATEN · See all ›" with a ＋ per row (05b) is a list you add FROM,
 * and the whole row being one target meant every re-log went through the amount sheet first: four
 * taps to have the same latte twice (owner, on device, 2026-08-20). Now the ＋ adds it at the
 * amount already shown, and the row itself opens the sheet for a different one.
 */
export function FoodPickRow({
  name,
  sub,
  kcal,
  tone = 'plain',
  busy,
  onAdd,
  onOpen,
}: {
  name: string;
  sub?: string;
  /** Already-formatted, so "~420 kcal" and "520 kcal" can both be honest. */
  kcal?: string;
  tone?: 'plain' | 'planned';
  busy?: boolean;
  onAdd: () => void;
  /** Open this one to change the amount. Omitted → the whole row is the add (planned meals). */
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="fq-row-t">
        <b>{name}</b>
        {sub && <span>{sub}</span>}
      </span>
      {kcal && <span className="fq-row-k">{kcal}</span>}
    </>
  );

  if (!onOpen) {
    return (
      <button type="button" className={`fq-row fq-row-${tone}`} disabled={busy} onClick={onAdd}>
        {body}
        <span className="fq-row-add" aria-hidden>
          ＋
        </span>
      </button>
    );
  }

  return (
    <div className={`fq-row fq-row-${tone}${busy ? ' is-busy' : ''}`}>
      <button
        type="button"
        className="fq-row-open"
        disabled={busy}
        aria-label={`${name} — change the amount`}
        onClick={onOpen}
      >
        {body}
      </button>
      <button
        type="button"
        className="fq-row-add"
        disabled={busy}
        aria-label={kcal ? `Add ${name}, ${kcal}` : `Add ${name}`}
        onClick={onAdd}
      >
        ＋
      </button>
    </div>
  );
}

/** A section label, with an optional "See all ›" on the right. */
export function FoodPickHead({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="fq-head">
      <span className="fq-head-l">{label}</span>
      {action}
    </div>
  );
}
