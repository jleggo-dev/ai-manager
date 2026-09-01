import type { SessionBlock, SessionItem } from '@cadence/shared';

/**
 * A circuit card's own fields (design C: "Circuit — rotate moves, rounds"). Kept deliberately
 * minimal against the design's own warning (TURN 1, 1A's strain): "a circuit's exercise list…
 * becomes a row that hides everything." Rounds is the one number the palette names; each exercise
 * gets a name plus EITHER reps or a timed hold (seconds) — plain inputs, no wheel widgets, same
 * rule as every other card.
 */
export function CircuitFields({
  block,
  onRounds,
  onExercise,
  onAdd,
  onRemove,
}: {
  block: SessionBlock;
  onRounds: (rounds: number) => void;
  onExercise: (exIndex: number, patch: Partial<SessionItem>) => void;
  onAdd: () => void;
  onRemove: (exIndex: number) => void;
}) {
  return (
    <div className="ab-circuit">
      <label className="ab-field">
        <span className="ab-field-l">Rounds</span>
        <input
          className="ab-in ab-in-num"
          type="number"
          min={1}
          aria-label="Rounds"
          value={block.rounds ?? 3}
          onChange={(e) => onRounds(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
      <div className="ab-circuit-list">
        {block.items.map((ex, i) => (
          <div className="ab-circuit-ex" key={i}>
            <input
              className="ab-in"
              type="text"
              aria-label={`Exercise ${i + 1} name`}
              value={ex.name}
              onChange={(e) => onExercise(i, { name: e.target.value })}
            />
            <input
              className="ab-in ab-in-num ab-in-small"
              type="number"
              min={0}
              placeholder="reps"
              aria-label={`Exercise ${i + 1} reps`}
              value={ex.reps ?? ''}
              onChange={(e) => onExercise(i, { reps: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
            <input
              className="ab-in ab-in-num ab-in-small"
              type="number"
              min={0}
              placeholder="sec"
              aria-label={`Exercise ${i + 1} seconds`}
              value={ex.duration_min ? Math.round(ex.duration_min * 60) : ''}
              onChange={(e) =>
                onExercise(i, { duration_min: e.target.value === '' ? undefined : Number(e.target.value) / 60 })
              }
            />
            <button
              type="button"
              className="ab-circuit-rm"
              aria-label={`Remove exercise ${i + 1}`}
              onClick={() => onRemove(i)}
              disabled={block.items.length <= 1}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="ab-circuit-add" onClick={onAdd}>
        ＋ Exercise
      </button>
    </div>
  );
}
