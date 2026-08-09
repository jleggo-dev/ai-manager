import type { CSSProperties } from 'react';
import { COMMAND_WORD, type HandsFree as HandsFreeState } from './useHandsFree.ts';

/**
 * The hands-free chip (interval design D). One shared component for every timer — the interval
 * player today, StepTimer countdowns, circuit rounds and the breath pacer next — so the four words
 * are learned once.
 *
 * Unlike the edit sheet's tooltips this chip **keeps its explanatory line on screen**: it is a live
 * status (what the mic is doing right now), not a definition you read once. It never moves or
 * grows between states either — glanceable, not modal.
 */
export function HandsFree({ state, on, onToggle }: { state: HandsFreeState; on: boolean; onToggle: () => void }) {
  const unavailable = state.status === 'unavailable';
  const live = on && !unavailable;
  const ink = unavailable ? 'oklch(45% 0.02 150)' : live ? 'oklch(42% 0.08 152)' : 'oklch(45% 0.02 150)';
  const sub = subLine(state, on, unavailable);

  return (
    <button
      type="button"
      onClick={unavailable ? undefined : onToggle}
      aria-pressed={live}
      aria-label="Hands-free voice control"
      disabled={unavailable}
      style={{
        ...chip,
        background: live ? 'oklch(97% 0.015 152)' : 'oklch(100% 0 0 / 0.7)',
        border: unavailable
          ? '1.5px dashed oklch(88% 0.02 85)'
          : `1.5px solid ${live ? 'oklch(85% 0.04 152)' : 'oklch(90% 0.015 95)'}`,
        cursor: unavailable ? 'default' : 'pointer',
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke={ink}
        strokeWidth={2.2}
        strokeLinecap="round"
        aria-hidden
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
        {unavailable && <path d="M4 4l16 16" />}
      </svg>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'left' }}>
        <span style={{ fontSize: 12.5, fontWeight: 900, color: ink }}>{title(state, live, unavailable)}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: live ? 'oklch(48% 0.05 152)' : 'oklch(55% 0.02 120)' }}>
          {sub}
        </span>
      </span>
      {live && (
        <span style={{ display: 'flex', gap: 3, alignItems: 'center' }} aria-hidden>
          {[0, 0.2, 0.4].map((delay) => (
            <span key={delay} style={{ ...dot, animationDelay: `${delay}s` }} />
          ))}
        </span>
      )}
    </button>
  );
}

function title(state: HandsFreeState, live: boolean, unavailable: boolean): string {
  if (unavailable) return 'Mic unavailable';
  if (state.heard) return `Heard “${state.heard}” ✓`;
  return live ? 'Hands-free is on' : 'Hands-free';
}

function subLine(state: HandsFreeState, on: boolean, unavailable: boolean): string {
  if (unavailable) return 'Permission denied or unsupported — the buttons still work';
  if (!on) return 'Off — tap to control the timer by voice';
  // Restart is the one word that can throw away a run someone is four rounds into.
  if (state.status === 'confirm') return 'Say “restart” again to confirm';
  // Built from what this surface actually accepts — a plain countdown must not advertise "skip".
  return `Listening for ${state.accepted.map((c) => COMMAND_WORD[c]).join(' · ')}`;
}

const chip: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  width: '100%',
  borderRadius: 14,
  padding: '10px 13px',
  boxSizing: 'border-box',
  font: 'inherit',
};
const dot: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'oklch(52% 0.09 152)',
  animation: 'cadence-pulse 1.2s infinite',
};
