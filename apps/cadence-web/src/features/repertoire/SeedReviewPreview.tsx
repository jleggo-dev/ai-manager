/**
 * A dev harness for the seed review — the screen a book turns into.
 *
 * It exists because the real thing costs a model call and needs a collection worth expanding, and
 * the three states worth eyeballing are exactly the ones you cannot summon: a book that came back
 * with a title naming two pieces, a collection the model does not know, and a lookup that broke.
 *
 * Registration is deliberately not here — the preview route table belongs to another parcel. Mount
 * this component wherever previews are listed.
 */
import { useState } from 'react';
import { SeedReview } from './SeedReview.tsx';

const CASES = ['Suzuki Piano Book 2', 'Shotokan kata', 'A collection nobody has heard of'] as const;

export function SeedReviewPreview() {
  const [collection, setCollection] = useState<string>(CASES[0]);
  const [done, setDone] = useState<number | null>(null);

  return (
    <div className="screen">
      <div className="detour-chips" style={{ padding: '12px 20px 0' }}>
        {CASES.map((c) => (
          <button
            key={c}
            type="button"
            className={`detour-chip${c === collection ? ' sr-chip--on' : ''}`}
            onClick={() => {
              setDone(null);
              setCollection(c);
            }}
          >
            {c}
          </button>
        ))}
      </div>
      {done === null ? (
        <SeedReview key={collection} collection={collection} onDone={setDone} />
      ) : (
        <div className="scrollbody">
          <p className="screen-sub">{`Saved ${done}. The real screen hands this number to whatever opened it.`}</p>
          <button type="button" className="detour-chip" onClick={() => setDone(null)}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}
