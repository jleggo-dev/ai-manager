import { useEffect, useState, type RefObject } from 'react';

/**
 * What the floating header is sitting on.
 *
 * Frame 2a's header overlays the trail instead of stacking above it, which removes the seam the
 * old layout could not avoid: a cream header meeting a navy trail at nine at night, two apps glued
 * together. To overlay it, the band has to know the colour underneath — so it samples the SKY's
 * lightness at its own scroll position and flips its whole palette at the day/night line. Cream
 * over a cream stretch, deep indigo over a night one.
 *
 * Opaque, deliberately. Translucent chrome was tried first and rejected: trail labels and the
 * coach bubble ghosted through the band, which is worse than the seam it was meant to solve.
 *
 * **The stops below are transcribed from `TodayTrail.tsx`'s `FIRST_SKY` / `LATER_SKY` — the L of
 * each oklch stop, at the same position.** They are duplicated rather than imported because the
 * gradients there are private strings, and this file is not allowed to edit that one; if a sky
 * stop moves, move it here too. A drift shows up as a header that turns dark slightly early or
 * late, never as a crash — which is exactly why it is written down rather than left to be noticed.
 */

/** `[position down the day 0..1, oklch lightness 0..1]`. */
export type SkyStop = readonly [at: number, lightness: number];

/** Today's sky: dawn at the top, night at the bottom. Transcribed from Linen (option 3b). */
export const FIRST_SKY_L: readonly SkyStop[] = [
  [0, 0.95],
  [0.16, 0.97],
  [0.36, 0.96],
  [0.56, 0.91],
  [0.74, 0.76],
  [0.88, 0.56],
  [1, 0.46],
];

/** Every later day: the same sky with the sunrise band at the top, where the divider sits. */
export const LATER_SKY_L: readonly SkyStop[] = [
  [0, 0.46],
  [0.04, 0.52],
  [0.08, 0.63],
  [0.13, 0.8],
  [0.19, 0.93],
  [0.3, 0.97],
  [0.46, 0.96],
  [0.62, 0.91],
  [0.78, 0.76],
  [0.91, 0.56],
  [1, 0.46],
];

/**
 * Where the header stops being a light band and becomes a dark one.
 *
 * **Unchanged by Linen, and that is a result rather than an oversight.** The old ramp put this
 * between dusk (0.58) and late afternoon (0.84); Linen's night floor is 0.46 and its dusk 0.56,
 * so the same 0.62 still lands in the gap — and it is what produces the study's own headline
 * number: the band is dark for ~21% of a scroll instead of ~34%, because the sky spends far less
 * of the day below the line. The design was measured against this threshold; moving it would
 * quietly redraw the thing that was picked.
 */
export const DARK_SKY_L = 0.62;

/** One day's sky as measured on screen: its band, and which gradient it is drawn with. */
export type SkyBand = { top: number; height: number; first: boolean };

/** Lightness at `fraction` down a gradient — linear between the two stops it falls between. */
export function skyLightnessAt(stops: readonly SkyStop[], fraction: number): number {
  const x = Math.max(0, Math.min(1, fraction));
  for (let i = 1; i < stops.length; i++) {
    const [p0, l0] = stops[i - 1]!;
    const [p1, l1] = stops[i]!;
    if (x <= p1) return l0 + (l1 - l0) * ((x - p0) / (p1 - p0 || 1));
  }
  return stops[stops.length - 1]![1];
}

/**
 * The sky's lightness at `probeY` (viewport pixels — the header's own bottom edge).
 *
 * `null` means "not over a sky at all": above the first day, or on a lens with no trail. The
 * caller keeps its own default there rather than guessing, because the page ground above the
 * trail is the cream app background, not a gradient we can sample.
 */
export function skyLightnessUnder(probeY: number, bands: readonly SkyBand[]): number | null {
  let under: SkyBand | null = null;
  for (const band of bands) {
    if (band.height > 0 && probeY >= band.top) under = band;
  }
  if (!under) return null;
  return skyLightnessAt(under.first ? FIRST_SKY_L : LATER_SKY_L, (probeY - under.top) / under.height);
}

/**
 * Night by the clock — the day/night signal the header starts from before it can measure anything,
 * and the one the weather glyph reads (`wxEmoji`). Deliberately not the sampled sky: the glyph sits
 * beside a temperature taken NOW, so it must not become a moon because you scrolled down to
 * tonight's stretch of the trail at lunchtime.
 *
 * A fixed window, because no sunrise/sunset reaches the client — `/me/weather` returns the current
 * reading and nothing else. Coarse, and better than the bug it replaces: keying off conditions
 * alone rendered ☀️ for a clear sky at nine at night.
 */
export function isNightHour(hour: number): boolean {
  return hour >= 20 || hour < 6;
}

/** Read every day-sky currently laid out inside `scroller`. */
function bandsIn(scroller: Element): SkyBand[] {
  return [...scroller.querySelectorAll('.trail-day')].map((day) => {
    const rect = day.getBoundingClientRect();
    // `.is-later` is the trail's own mark for "drawn with LATER_SKY" — read the class rather than
    // the index, so a trail that ever renders days in another order still samples the right ramp.
    return { top: rect.top, height: rect.height, first: !day.classList.contains('is-later') };
  });
}

/**
 * The floating header's two measurements, taken together because they share one observer:
 *
 *  1. **How dark the sky under it is** — returned, and applied as the band's palette.
 *  2. **How tall it is** — published as `--thead-h` on the parent, so the scroller below can start
 *     clear of a header that is no longer in the layout flow. It is written on the parent element
 *     rather than passed as a prop because the header does not own the screen it floats over.
 *
 * `fallbackDark` holds whenever there is no sky to read (the Week lens, the moment before the plan
 * paints, the stretch of page above the first day).
 */
export function useSkyTint(ref: RefObject<HTMLElement>, fallbackDark: boolean): boolean {
  const [dark, setDark] = useState(fallbackDark);

  useEffect(() => {
    const head = ref.current;
    const host = head?.parentElement;
    const scroller = host?.querySelector('.scrollbody');
    if (!head || !host) return;

    let queued = false;
    const measure = () => {
      queued = false;
      host.style.setProperty('--thead-h', `${Math.round(head.getBoundingClientRect().height)}px`);
      if (!scroller) return setDark(fallbackDark);
      const lightness = skyLightnessUnder(head.getBoundingClientRect().bottom, bandsIn(scroller));
      setDark(lightness == null ? fallbackDark : lightness < DARK_SKY_L);
    };
    // Scroll fires far faster than the band can change colour; one read per frame is plenty and
    // keeps `getBoundingClientRect` off the scroll thread's critical path.
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    };

    measure();
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // The trail paints after the plan resolves and grows again as the recap lands, so a single
    // pass at mount would sample a screen that no longer exists.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll);
    observer?.observe(head);
    if (scroller?.firstElementChild) observer?.observe(scroller.firstElementChild);

    return () => {
      scroller?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      observer?.disconnect();
      host.style.removeProperty('--thead-h');
    };
  }, [ref, fallbackDark]);

  return dark;
}
