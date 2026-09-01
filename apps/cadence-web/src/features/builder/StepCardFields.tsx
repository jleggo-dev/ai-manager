import type { ReactNode } from 'react';
import { BREATH_PATTERNS, GROUNDING_GAMES, GROUNDING_NAMES, MEDITATE_BELL_KINDS } from '@cadence/shared';
import type { MeditateBells, SessionItem, StepToolKind } from '@cadence/shared';

/**
 * The tool-specific fields inside one step card (design 1B: "tap opens that tool's config sheet").
 * Per the parcel brief these stay **plain inputs in the card, no wheel widgets** — text/number/
 * select, never a scroll-wheel picker — so every number a seed shipped with stays a one-tap-away
 * edit (law 2, "seed, never lock").
 *
 * Dispatches on the tool `inferTool` already resolved for the card (never re-derives it) so the
 * fields shown always match the chip the card is wearing.
 */
export function StraightFields({
  kind,
  item,
  onPatch,
}: {
  kind: StepToolKind;
  item: SessionItem;
  onPatch: (patch: Partial<SessionItem>) => void;
}) {
  switch (kind) {
    case 'timer':
      return (
        <MinutesField
          label="Minutes"
          value={item.duration_min ?? 1}
          onChange={(duration_min) => onPatch({ duration_min })}
        />
      );
    case 'interval':
      return <IntervalFields item={item} onPatch={onPatch} />;
    case 'reps':
      return <RepsFields item={item} onPatch={onPatch} />;
    case 'breathing':
      return <BreathingFields item={item} onPatch={onPatch} />;
    case 'meditate':
      return <MeditateFields item={item} onPatch={onPatch} />;
    case 'grounding':
      return <GroundingSelect item={item} onPatch={onPatch} />;
    case 'checkoff':
      return (
        <TextRow label="Distance (km, optional)">
          <input
            className="ab-in ab-in-num"
            type="number"
            min={0}
            step="0.1"
            aria-label="Distance (km, optional)"
            value={item.distance_km ?? ''}
            onChange={(e) => onPatch({ distance_km: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </TextRow>
      );
    case 'read':
      return <CueFields item={item} onPatch={onPatch} />;
    case 'journal':
      return <WriteFields item={item} onPatch={onPatch} />;
    case 'measure':
      return <MeasureFields item={item} onPatch={onPatch} />;
    case 'feeling_log':
      return <div className="ab-fixed-note">One word, twenty seconds — no configuration, same every time.</div>;
    default:
      return null;
  }
}

function TextRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ab-field">
      <span className="ab-field-l">{label}</span>
      {children}
    </label>
  );
}

function MinutesField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <TextRow label={label}>
      <input
        className="ab-in ab-in-num"
        type="number"
        min={1}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
      />
    </TextRow>
  );
}

function IntervalFields({ item, onPatch }: { item: SessionItem; onPatch: (p: Partial<SessionItem>) => void }) {
  return (
    <div className="ab-field-row">
      <TextRow label="Work (sec)">
        <input
          className="ab-in ab-in-num"
          type="number"
          min={5}
          aria-label="Work seconds"
          value={item.interval_work_sec ?? 40}
          onChange={(e) => onPatch({ interval_work_sec: Math.max(5, Number(e.target.value) || 5) })}
        />
      </TextRow>
      <TextRow label="Recover (sec)">
        <input
          className="ab-in ab-in-num"
          type="number"
          min={0}
          aria-label="Recover seconds"
          value={item.interval_recover_sec ?? 20}
          onChange={(e) => onPatch({ interval_recover_sec: Math.max(0, Number(e.target.value) || 0) })}
        />
      </TextRow>
      <TextRow label="Rounds">
        <input
          className="ab-in ab-in-num"
          type="number"
          min={1}
          aria-label="Rounds"
          value={item.interval_rounds ?? 6}
          onChange={(e) => onPatch({ interval_rounds: Math.max(1, Number(e.target.value) || 1) })}
        />
      </TextRow>
    </div>
  );
}

function RepsFields({ item, onPatch }: { item: SessionItem; onPatch: (p: Partial<SessionItem>) => void }) {
  return (
    <div className="ab-field-row">
      <TextRow label="Sets">
        <input
          className="ab-in ab-in-num"
          type="number"
          min={1}
          aria-label="Sets"
          value={item.sets ?? 1}
          onChange={(e) => onPatch({ sets: Math.max(1, Number(e.target.value) || 1) })}
        />
      </TextRow>
      <TextRow label="Reps">
        <input
          className="ab-in ab-in-num"
          type="number"
          min={0}
          aria-label="Reps"
          value={item.reps ?? ''}
          onChange={(e) => onPatch({ reps: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
      </TextRow>
      <TextRow label="Load">
        <input
          className="ab-in"
          type="text"
          aria-label="Load"
          placeholder="bodyweight, 55 lb…"
          value={item.load ?? ''}
          onChange={(e) => onPatch({ load: e.target.value || undefined })}
        />
      </TextRow>
    </div>
  );
}

function BreathingFields({ item, onPatch }: { item: SessionItem; onPatch: (p: Partial<SessionItem>) => void }) {
  return (
    <div className="ab-field-row">
      <TextRow label="Pattern">
        <select
          className="ab-in"
          aria-label="Pattern"
          value={item.breath_pattern ?? 'coherent'}
          onChange={(e) => onPatch({ breath_pattern: e.target.value })}
        >
          {BREATH_PATTERNS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </TextRow>
      <TextRow label="Cycles">
        <input
          className="ab-in ab-in-num"
          type="number"
          min={1}
          aria-label="Cycles"
          value={item.breath_cycles ?? 6}
          onChange={(e) => onPatch({ breath_cycles: Math.max(1, Number(e.target.value) || 1) })}
        />
      </TextRow>
    </div>
  );
}

function MeditateFields({ item, onPatch }: { item: SessionItem; onPatch: (p: Partial<SessionItem>) => void }) {
  return (
    <div className="ab-field-row">
      <MinutesField
        label="Minutes"
        value={item.duration_min ?? 10}
        onChange={(duration_min) => onPatch({ duration_min })}
      />
      <TextRow label="Bells">
        <select
          className="ab-in"
          aria-label="Bells"
          value={item.meditate_bells ?? 'start_end'}
          onChange={(e) => onPatch({ meditate_bells: e.target.value as MeditateBells })}
        >
          {MEDITATE_BELL_KINDS.map((b) => (
            <option key={b} value={b}>
              {b === 'none' ? 'No bells' : b === 'start_end' ? 'Start & end' : 'Start, end & every few minutes'}
            </option>
          ))}
        </select>
      </TextRow>
    </div>
  );
}

function GroundingSelect({ item, onPatch }: { item: SessionItem; onPatch: (p: Partial<SessionItem>) => void }) {
  return (
    <TextRow label="Game">
      <select
        className="ab-in"
        aria-label="Game"
        value={item.grounding_game ?? 'senses'}
        onChange={(e) => onPatch({ grounding_game: e.target.value })}
      >
        {GROUNDING_GAMES.map((g) => (
          <option key={g} value={g}>
            {GROUNDING_NAMES[g]}
          </option>
        ))}
      </select>
    </TextRow>
  );
}

function CueFields({ item, onPatch }: { item: SessionItem; onPatch: (p: Partial<SessionItem>) => void }) {
  return (
    <div className="ab-field-row">
      <TextRow label="Cue">
        <input
          className="ab-in"
          type="text"
          aria-label="Cue"
          placeholder="Words to follow…"
          value={item.detail ?? ''}
          onChange={(e) => onPatch({ detail: e.target.value })}
        />
      </TextRow>
      <MinutesField
        label="Minutes"
        value={item.duration_min ?? 1}
        onChange={(duration_min) => onPatch({ duration_min })}
      />
    </div>
  );
}

function WriteFields({ item, onPatch }: { item: SessionItem; onPatch: (p: Partial<SessionItem>) => void }) {
  return (
    <div className="ab-field-col">
      <TextRow label="Prompt">
        <textarea
          className="ab-in ab-textarea"
          aria-label="Prompt"
          rows={2}
          value={item.detail ?? ''}
          onChange={(e) => onPatch({ detail: e.target.value })}
        />
      </TextRow>
      <TextRow label="Minutes (blank = untimed)">
        <input
          className="ab-in ab-in-num"
          type="number"
          min={0}
          aria-label="Minutes (blank = untimed)"
          value={item.duration_min ?? ''}
          onChange={(e) =>
            onPatch({ duration_min: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })
          }
        />
      </TextRow>
    </div>
  );
}

function MeasureFields({ item, onPatch }: { item: SessionItem; onPatch: (p: Partial<SessionItem>) => void }) {
  return (
    <div className="ab-field-row">
      <TextRow label="Metric">
        <input
          className="ab-in"
          type="text"
          aria-label="Metric"
          value={item.measure_metric ?? ''}
          onChange={(e) => onPatch({ measure_metric: e.target.value })}
        />
      </TextRow>
      <TextRow label="Unit">
        <input
          className="ab-in"
          type="text"
          aria-label="Unit"
          value={item.measure_unit ?? ''}
          onChange={(e) => onPatch({ measure_unit: e.target.value })}
        />
      </TextRow>
    </div>
  );
}
