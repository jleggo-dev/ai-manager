import type { CSSProperties } from 'react';
import { TONE } from './tone.ts';
import '../../../styles/pace-slider.css';

/** Fine enough that no one can feel a step on a phone-width track: the slider reads as smooth. */
const STEP = 0.01;

/** Both animals look outward, toward the end of the track they stand for. */
const RabbitIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="26"
    height="26"
    fill="currentColor"
    aria-hidden
    data-testid="pace-quick"
    style={{ flexShrink: 0 }}
  >
    <ellipse cx="9.4" cy="6.2" rx="1.5" ry="4.6" transform="rotate(14 9.4 6.2)" />
    <ellipse cx="12.3" cy="7" rx="1.5" ry="4.4" transform="rotate(32 12.3 7)" />
    <circle cx="7.4" cy="12.6" r="3.6" />
    <ellipse cx="14.2" cy="15.4" rx="6.6" ry="4.9" />
    <circle cx="21" cy="13.8" r="1.6" />
    <rect x="5.6" y="18.6" width="6.4" height="2.2" rx="1.1" />
    <rect x="13" y="18.6" width="7.4" height="2.2" rx="1.1" />
  </svg>
);

const TurtleIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="26"
    height="26"
    fill="currentColor"
    aria-hidden
    data-testid="pace-slow"
    style={{ flexShrink: 0 }}
  >
    <path d="M2.5 16a8 8 0 0 1 16 0z" />
    <path d="M16.5 16v-2.2l2-1.6h2.1a2.4 2.4 0 0 1 0 4.8h-2.4z" />
    <rect x="5" y="15" width="3.6" height="4.2" rx="1.6" />
    <rect x="12.6" y="15" width="3.6" height="4.2" rx="1.6" />
    <path d="M2.8 14.6 0.8 16.4 3.4 16.2z" />
  </svg>
);

/**
 * How long a count lasts, set by feel. No words and no numbers: the form above breathes at this
 * pace while it moves, so the circle is the readout (owner, 2026-11-06 — "just put a rabbit and a
 * turtle"). `value` is seconds per count, so it rises toward the turtle.
 */
export function PaceSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (pace: number) => void;
}) {
  return (
    <div style={row}>
      <RabbitIcon />
      <input
        className="pace-slider"
        type="range"
        aria-label="Pace"
        min={min}
        max={max}
        step={STEP}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <TurtleIcon />
    </div>
  );
}

const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, color: TONE.sub };
