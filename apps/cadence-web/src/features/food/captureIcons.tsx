/**
 * The capture methods' glyphs, in one place because 05a's quick-add sheet and 05b's full Log
 * screen draw the same set at two sizes. Stroke-only, currentColor, so a tile decides its own tint.
 */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * A speech bubble: rounded box, tail at the lower left (canvas "Cadence Quick Log", 2026-10-29).
 * The one it replaced drew its left arc between two points further apart than the arc's radius,
 * so SVG stretched the curve and the bubble came out lopsided with its tail hanging below the box.
 */
export const ChatIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path
      d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z"
      {...S}
    />
  </svg>
);

/** "Type it" — the door for words. A pencil, because the bubble now means talking WITH her. */
export const PencilIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path d="M4 20h4.5L19 9.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20z" {...S} />
    <path d="M13.5 8.5l3 3M11 20h9" {...S} />
  </svg>
);

export const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <rect x="9.2" y="2.8" width="5.6" height="11" rx="2.8" {...S} />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.2" {...S} />
  </svg>
);

export const CameraIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path
      d="M4 8.5h3l1.2-2h5.6L15 8.5h3a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 18 18.5H4A1.5 1.5 0 0 1 2.5 17v-7A1.5 1.5 0 0 1 4 8.5z"
      {...S}
    />
    <circle cx="11" cy="13" r="2.7" {...S} />
  </svg>
);

export const ScanIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path
      d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"
      {...S}
    />
    <path d="M7.5 8.5v7M10 8.5v7M13 8.5v7M16.5 8.5v7" {...S} strokeWidth="1.4" />
  </svg>
);

export const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <circle cx="10.8" cy="10.8" r="6.3" {...S} />
    <path d="M15.4 15.4 20 20" {...S} />
  </svg>
);

export const WaterIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
    <path d="M12 3.2s5.5 6 5.5 9.6a5.5 5.5 0 1 1-11 0C6.5 9.2 12 3.2 12 3.2z" {...S} />
  </svg>
);
