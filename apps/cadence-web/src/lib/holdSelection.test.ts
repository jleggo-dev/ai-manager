/**
 * The selection guard a hold puts up (owner, on device, 2026-11-01: holding a Plan disc opened
 * the menu AND selected the whole page, Copy / Share menu on top). From the hold until just after
 * the lift, no selection starts and any that lands is cleared; then the page selects normally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardSelectionThroughHold, HOLD_SELECTION_CAP_MS, HOLD_SELECTION_SETTLE_MS } from './holdSelection.ts';

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<p id="words">Long run - building time on feet</p>';
});
afterEach(() => {
  stop?.();
  stop = null;
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Select the paragraph, as iOS's long press does. */
function selectWords(): void {
  const range = document.createRange();
  range.selectNodeContents(document.getElementById('words')!);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Whether a selection would be allowed to start right now. */
function selectionAllowed(): boolean {
  const e = new Event('selectstart', { bubbles: true, cancelable: true });
  document.getElementById('words')!.dispatchEvent(e);
  return !e.defaultPrevented;
}

const selected = () => document.getSelection()!.toString();

describe('guardSelectionThroughHold', () => {
  it('clears a selection that is already there when the hold fires', () => {
    selectWords();
    expect(selected()).not.toBe('');
    stop = guardSelectionThroughHold();
    expect(selected()).toBe('');
  });

  it('refuses a new selection while the finger is down, and clears one that lands anyway', () => {
    stop = guardSelectionThroughHold();
    expect(selectionAllowed()).toBe(false);
    selectWords();
    document.dispatchEvent(new Event('selectionchange'));
    expect(selected()).toBe('');
  });

  it('stays up briefly after the lift, then lets the page select again', () => {
    stop = guardSelectionThroughHold();
    window.dispatchEvent(new Event('pointerup'));
    vi.advanceTimersByTime(HOLD_SELECTION_SETTLE_MS - 1);
    expect(selectionAllowed()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(selectionAllowed()).toBe(true);
    selectWords();
    document.dispatchEvent(new Event('selectionchange'));
    expect(selected()).not.toBe('');
  });

  it.each(['pointercancel', 'touchend', 'touchcancel'])('a %s counts as the lift', (type) => {
    stop = guardSelectionThroughHold();
    window.dispatchEvent(new Event(type));
    vi.advanceTimersByTime(HOLD_SELECTION_SETTLE_MS);
    expect(selectionAllowed()).toBe(true);
  });

  it('ends on its own if the lift never arrives', () => {
    stop = guardSelectionThroughHold();
    vi.advanceTimersByTime(HOLD_SELECTION_CAP_MS - 1);
    expect(selectionAllowed()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(selectionAllowed()).toBe(true);
  });

  it('leaves a caret alone — a cursor in a text field is not a selection', () => {
    const range = document.createRange();
    range.setStart(document.getElementById('words')!.firstChild!, 3);
    range.collapse(true);
    document.getSelection()!.addRange(range);
    stop = guardSelectionThroughHold();
    expect(document.getSelection()!.rangeCount).toBe(1);
  });
});
