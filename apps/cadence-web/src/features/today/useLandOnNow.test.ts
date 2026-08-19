/**
 * Where the trail opens. Since the floating START pill went, landing on the current node IS the
 * "what's next" signal — so the two things that can go wrong are landing on the wrong node, and
 * landing on the right one but parked under the header that floats over the trail.
 */
import { renderHook } from '@testing-library/react';
import { currentNodeIndex, useLandOnNow } from './useLandOnNow.ts';
import type { PlanOccurrence } from '../../lib/api.ts';

const occ = (status: PlanOccurrence['status'], id: string): PlanOccurrence => ({
  occurrence_id: id,
  activity_id: 'a1',
  title: id,
  kind: 'user',
  status,
});

describe('currentNodeIndex', () => {
  it('is the first thing today you have not settled', () => {
    expect(currentNodeIndex([occ('done', 'a'), occ('skipped', 'b'), occ('pending', 'c'), occ('pending', 'd')])).toBe(2);
  });

  it('is the last node once the whole day is behind you', () => {
    expect(currentNodeIndex([occ('done', 'a'), occ('skipped', 'b')])).toBe(1);
  });

  it('picks nothing on an empty day', () => {
    expect(currentNodeIndex([])).toBe(-1);
  });
});

/** A scroll pane with a node in it — jsdom lays nothing out, so geometry is stated outright. */
function harness(nodeTop: number, paneTop = 100, scrollTop = 0) {
  const pane = document.createElement('div');
  pane.style.overflowY = 'auto';
  Object.defineProperty(pane, 'scrollHeight', { value: 3000, writable: true });
  Object.defineProperty(pane, 'clientHeight', { value: 700, writable: true });
  pane.scrollTop = scrollTop;
  pane.getBoundingClientRect = () => ({ top: paneTop }) as unknown as DOMRect;

  const node = document.createElement('button');
  node.getBoundingClientRect = () => ({ top: nodeTop }) as unknown as DOMRect;
  pane.appendChild(node);
  document.body.appendChild(pane);
  return { pane, node };
}

function land(node: HTMLButtonElement) {
  const { result, rerender } = renderHook(() => useLandOnNow());
  (result.current as { current: HTMLButtonElement | null }).current = node;
  rerender();
  return rerender;
}

describe('useLandOnNow', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** 1000 − 100 = 900px down the pane, less the 72px fallback lead the header wants. */
  it('scrolls the pane so the node clears the floating header', () => {
    const { pane, node } = harness(1000);
    land(node);
    expect(pane.scrollTop).toBe(828);
  });

  it('keeps the offset relative to where the pane already sits', () => {
    const { pane, node } = harness(1000, 100, 250);
    land(node);
    expect(pane.scrollTop).toBe(1078);
  });

  it('never scrolls past the top of the trail for a node that is already up there', () => {
    const { pane, node } = harness(120);
    land(node);
    expect(pane.scrollTop).toBe(0);
  });

  /**
   * The useStickToBottom lesson, in the one-shot form: a re-render (a refetch landing, the plan
   * refreshing) must never yank the viewport back off whatever the reader has scrolled to.
   */
  it('lands once and then leaves the viewport alone', () => {
    const { pane, node } = harness(1000);
    const rerender = land(node);
    expect(pane.scrollTop).toBe(828);

    pane.scrollTop = 40; // they scrolled up to look at the morning
    rerender();
    expect(pane.scrollTop).toBe(40);
  });

  it('does nothing when nothing around the node scrolls', () => {
    const node = document.createElement('button');
    document.body.appendChild(node);
    expect(() => land(node)).not.toThrow();
  });
});
