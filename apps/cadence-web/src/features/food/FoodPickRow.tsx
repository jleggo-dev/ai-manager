import type { ReactNode } from 'react';

/**
 * One addable line — name, the honest sub-line under it, its calories, and a ＋. The same row
 * serves the quick-add sheet (05a) and the full Log screen (05b), so what a planned meal looks
 * like and what a food you eat every week looks like never drift apart.
 */
export function FoodPickRow({
  name,
  sub,
  kcal,
  tone = 'plain',
  busy,
  onAdd,
}: {
  name: string;
  sub?: string;
  /** Already-formatted, so "~420 kcal" and "520 kcal" can both be honest. */
  kcal?: string;
  tone?: 'plain' | 'planned';
  busy?: boolean;
  onAdd: () => void;
}) {
  return (
    <button type="button" className={`fq-row fq-row-${tone}`} disabled={busy} onClick={onAdd}>
      <span className="fq-row-t">
        <b>{name}</b>
        {sub && <span>{sub}</span>}
      </span>
      {kcal && <span className="fq-row-k">{kcal}</span>}
      <span className="fq-row-add" aria-hidden>
        ＋
      </span>
    </button>
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
