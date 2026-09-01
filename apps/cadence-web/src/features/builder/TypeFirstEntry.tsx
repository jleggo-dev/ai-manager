import { FAMILIES, familyOf, seedsForFamily, type BuilderFamily, type BuilderSeed } from './builderSeeds.ts';

/**
 * Type-first entry (design B) — "What are you building?" Shown only when there is no session yet
 * (`ActivityBuilder.tsx` skips straight to the builder otherwise — editing, or a from-Cadence /
 * from-Recap copy). Two screens sharing one file because they're one small back-and-forth, not two
 * standalone surfaces: pick a family, then pick a starting point (or back up and pick a different
 * family). "Start blank instead" skips both — the escape hatch design B keeps at the floor.
 */
export function TypeFirstEntry({
  family,
  onPickFamily,
  onPickSeed,
  onBlank,
  onBackToFamilies,
  onClose,
}: {
  family: BuilderFamily | null;
  onPickFamily: (family: BuilderFamily) => void;
  onPickSeed: (seed: BuilderSeed) => void;
  onBlank: () => void;
  onBackToFamilies: () => void;
  onClose: () => void;
}) {
  if (family) return <SeedScreen family={family} onPickSeed={onPickSeed} onBack={onBackToFamilies} />;
  return <FamilyScreen onPickFamily={onPickFamily} onBlank={onBlank} onClose={onClose} />;
}

function FamilyScreen({
  onPickFamily,
  onBlank,
  onClose,
}: {
  onPickFamily: (family: BuilderFamily) => void;
  onBlank: () => void;
  onClose: () => void;
}) {
  return (
    <div className="ab" role="region" aria-label="Build your own activity">
      <div className="ab-head">
        <button className="ab-back" onClick={onClose} aria-label="Cancel">
          ‹
        </button>
        <b className="ab-title">Build your own</b>
      </div>
      <div className="ab-body">
        <div className="ab-type-head">
          <div className="ab-type-h1">What are you building?</div>
          <div className="ab-type-sub">This just picks your starting point — everything stays editable.</div>
        </div>
        <div className="ab-family-list">
          {FAMILIES.map((f) => (
            <button type="button" key={f.id} className="ab-family-row" onClick={() => onPickFamily(f.id)}>
              <span className="ab-dot" style={{ background: f.color }} aria-hidden />
              <span className="ab-family-t">
                <b>{f.label}</b>
                <span>{f.hint}</span>
              </span>
              <span className="ab-chev" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="ab-blank-row" onClick={onBlank}>
          Start blank instead
        </button>
      </div>
    </div>
  );
}

function SeedScreen({
  family,
  onPickSeed,
  onBack,
}: {
  family: BuilderFamily;
  onPickSeed: (seed: BuilderSeed) => void;
  onBack: () => void;
}) {
  const def = familyOf(family);
  const seeds = seedsForFamily(family);
  return (
    <div className="ab" role="region" aria-label={`${def.label} starting points`}>
      <div className="ab-head">
        <button className="ab-back" onClick={onBack} aria-label="Back to families">
          ‹
        </button>
        <b className="ab-title">{def.label}</b>
      </div>
      <div className="ab-body">
        <div className="ab-type-sub ab-seed-sub">A copy becomes yours — edit anything.</div>
        <div className="ab-seed-list">
          {seeds.map((seed) => (
            <button type="button" key={seed.id} className="ab-seed-row" onClick={() => onPickSeed(seed)}>
              <span className="ab-dot" style={{ background: def.color }} aria-hidden />
              <span className="ab-seed-t">
                <b>{seed.title}</b>
                <span>{seed.summary}</span>
              </span>
              <span className="ab-chev" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
