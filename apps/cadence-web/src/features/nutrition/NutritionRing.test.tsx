/**
 * The ring's track is ALWAYS smooth — the contract this file exists to hold.
 *
 * It used to be drawn dashed on a day with no calorie target ("counting, not scoring"). At the
 * stroke widths the ring actually renders (9px on the 52px trail strip, 12px on the 112px Food
 * home) the round dash caps overlap their own gaps and fuse the dashes into one scalloped loop —
 * a ring with a chewed edge rather than a dotted outline. An ordinary morning before anyone has
 * eaten rendered as a damaged thing, against BRAND.md's *count what happened, never what broke*
 * (owner, 2026-08-20). "No target" is now said in the copy beside the ring, never in its texture.
 *
 * So: the track carries no dash pattern and no round cap in ANY state, and a target-less ring is
 * drawn exactly like a scored ring nobody has eaten into yet. The ARCS keep their dasharray —
 * that is how an arc is drawn at all — so every assertion here is about the track specifically,
 * which is always the first <circle> in the SVG.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NutritionRing } from './NutritionRing.tsx';

afterEach(cleanup);

const circles = (el: HTMLElement): SVGCircleElement[] => Array.from(el.querySelectorAll('circle'));
const track = (el: HTMLElement): SVGCircleElement => {
  const [first] = circles(el);
  if (!first) throw new Error('the ring drew no track at all');
  return first;
};

/** Everything that could crenulate an edge, in one place — none of it may ever touch the track. */
const expectSmooth = (c: SVGCircleElement) => {
  expect(c.getAttribute('stroke-dasharray')).toBeNull();
  expect(c.getAttribute('stroke-dashoffset')).toBeNull();
  expect(c.getAttribute('pathLength')).toBeNull();
  // The round cap is what made the dashes fuse into scallops; a solid track has no use for one.
  expect(c.getAttribute('stroke-linecap')).toBeNull();
};

describe('NutritionRing — the track is always smooth', () => {
  it('draws a smooth track on a target-less day with nothing eaten (the reported bug)', () => {
    const { container } = render(<NutritionRing logged={0} target={null} size={112} stroke={12} />);
    expectSmooth(track(container));
  });

  it('stays smooth on a target-less day once food is logged', () => {
    // No target means no denominator, so there is still nothing to fill — but the ring must not
    // change texture between an empty morning and a fed afternoon. That flip was the whole report.
    const { container } = render(<NutritionRing logged={1240} target={null} size={112} stroke={12} />);
    expectSmooth(track(container));
    expect(circles(container)).toHaveLength(1);
  });

  it('stays smooth at trail-strip size, where the fusing was worst', () => {
    const { container } = render(<NutritionRing logged={0} target={undefined} size={52} stroke={9} />);
    expectSmooth(track(container));
  });

  it('draws a target-less ring exactly like a scored ring nobody has eaten into', () => {
    // Both mean "nothing yet". The line underneath is what tells them apart, not the ring.
    const { container: none } = render(<NutritionRing logged={0} target={null} size={112} stroke={12} />);
    const { container: scored } = render(<NutritionRing logged={0} target={2000} size={112} stroke={12} />);
    expect(track(none).outerHTML).toBe(track(scored).outerHTML);
  });

  it('keeps the track smooth once an arc is drawn over it', () => {
    const { container } = render(<NutritionRing logged={1000} target={2000} size={112} stroke={12} />);
    expectSmooth(track(container));
    // The arc is a real arc — it still needs its own dasharray, and that is not the track's.
    const arc = circles(container).at(-1);
    expect(arc?.getAttribute('stroke-dasharray')).toBe('50 50');
  });
});
