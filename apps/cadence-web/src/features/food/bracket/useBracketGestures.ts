/**
 * The bracket's gesture engine (owner ruling 3 — the full set, docs/cadence/MEAL-LOGGING.md):
 *
 *   (a) pull a row's gutter notch down over neighbours → they bracket (onGroup);
 *   (b) drag an indented member LEFT out of the indent → it leaves (onRemoveFromPart);
 *   (c) drag a loose row RIGHT into a neighbouring bracket → it joins (onAddToPart);
 *   (d) grab either end of a bracket → resize over neighbours (add/remove per row crossed);
 *   (e) last one out ungroups on its own — the reducers and the server both enforce it.
 *
 * Pointer events, touch and mouse alike (the app lives in an iOS webview). The one hard rule:
 * a drag must NOT hijack scroll. Rows start uncaptured and only claim the pointer once
 * horizontal movement dominates (the intent lock); the notch and the bracket ends are dedicated
 * handles, so they capture at once. Every callback is optional — with none wired the list is
 * inert, which is the diary's read-only use.
 */
import { useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import type { BracketRow } from './partModel.ts';

export interface BracketGestureCallbacks {
  onGroup?: (indexes: number[]) => void;
  onAddToPart?: (partKey: string, index: number) => void;
  onRemoveFromPart?: (partKey: string, index: number) => void;
  /** 2b's other door: long-press enters select mode. Fires only when the pointer has not moved. */
  onLongPress?: (index: number) => void;
}

/** Movement below this is a tap; at it, whichever axis dominates owns the pointer. */
export const INTENT_LOCK_PX = 8;
/** Horizontal travel that commits a leave/join when the finger lifts. */
export const COMMIT_PX = 56;
export const LONG_PRESS_MS = 450;

export type BracketDragState =
  | { kind: 'idle' }
  | { kind: 'group'; anchor: number; itemIndexes: number[] }
  | { kind: 'leave'; index: number; partKey: string; dx: number; past: boolean }
  | { kind: 'join'; index: number; partKey: string; dx: number; past: boolean }
  | { kind: 'resize'; partKey: string; edge: 'head' | 'tail'; add: number[]; remove: number[] };

const IDLE: BracketDragState = { kind: 'idle' };

/** Which axis a move declares, or 'none' while it is still inside the lock. */
export function dragAxis(dx: number, dy: number): 'horizontal' | 'vertical' | 'none' {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < INTENT_LOCK_PX) return 'none';
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
}

/** The bracket a loose row would join: the part directly above it, else directly below. */
export function adjacentPartFor(rows: BracketRow[], rowIdx: number): string | null {
  const above = rows[rowIdx - 1];
  if (above?.kind === 'part') return above.part.key;
  const below = rows[rowIdx + 1];
  if (below?.kind === 'part') return below.part.key;
  return null;
}

interface Mid {
  key: number;
  mid: number;
}

function collectMids(map: Map<number, HTMLElement>): Mid[] {
  return [...map.entries()]
    .map(([key, el]) => {
      const r = el.getBoundingClientRect();
      return { key, mid: r.top + r.height / 2 };
    })
    .sort((a, b) => a.mid - b.mid);
}

const midOf = (mids: Mid[], key: number): number | undefined => mids.find((m) => m.key === key)?.mid;

/**
 * The item indexes a notch drag has taken: the anchor, then contiguous LOOSE rows toward the
 * pointer whose midpoint it has passed. A part block stops the walk — brackets never nest.
 */
export function groupSpan(rows: BracketRow[], rowMids: Mid[], anchorRow: number, y: number): number[] {
  const anchor = rows[anchorRow];
  if (anchor?.kind !== 'item') return [];
  const taken = [anchor.index];
  const anchorMid = midOf(rowMids, anchorRow) ?? y;
  const dir = y >= anchorMid ? 1 : -1;
  for (let r = anchorRow + dir; r >= 0 && r < rows.length; r += dir) {
    const row = rows[r];
    if (!row || row.kind !== 'item') break;
    const mid = midOf(rowMids, r);
    if (mid === undefined) break;
    if (dir === 1 ? y < mid : y > mid) break;
    taken.push(row.index);
  }
  return taken.sort((a, b) => a - b);
}

/**
 * What an end-drag has crossed: loose rows beyond the edge join (`add`); members the pointer has
 * pulled back past leave (`remove`). Growing and shrinking are exclusive — whichever side of the
 * edge the pointer is on decides.
 */
export function resizeDiff(
  rows: BracketRow[],
  rowMids: Mid[],
  memberMids: Mid[],
  partKey: string,
  edge: 'head' | 'tail',
  y: number,
): { add: number[]; remove: number[] } {
  const at = rows.findIndex((r) => r.kind === 'part' && r.part.key === partKey);
  const partRow = rows[at];
  if (partRow?.kind !== 'part') return { add: [], remove: [] };
  const dir = edge === 'tail' ? 1 : -1;
  const add: number[] = [];
  for (let r = at + dir; r >= 0 && r < rows.length; r += dir) {
    const row = rows[r];
    if (!row || row.kind !== 'item') break;
    const mid = midOf(rowMids, r);
    if (mid === undefined) break;
    if (dir === 1 ? y < mid : y > mid) break;
    add.push(row.index);
  }
  if (add.length) return { add, remove: [] };
  const members = edge === 'tail' ? [...partRow.memberIndexes].reverse() : partRow.memberIndexes;
  const remove: number[] = [];
  for (const m of members) {
    const mid = midOf(memberMids, m);
    if (mid === undefined) break;
    if (edge === 'tail' ? y < mid : y > mid) remove.push(m);
    else break;
  }
  return { add: [], remove };
}

interface Session {
  pointerId: number;
  mode: 'row' | 'notch' | 'end';
  el: HTMLElement | null;
  startX: number;
  startY: number;
  /** row/notch modes */
  rowIdx: number;
  itemIndex: number;
  partKey: string | null; // the member's own part (leave) …
  joinKey: string | null; // … or the neighbour a loose row would join
  /** end mode */
  resize: { partKey: string; edge: 'head' | 'tail' } | null;
  axis: 'none' | 'active' | 'abandoned';
  rowMids: Mid[];
  memberMids: Mid[];
  timer: ReturnType<typeof setTimeout> | null;
}

/** Everything the module-level handlers need — the hook only wires this up. */
interface Ctx {
  session: MutableRefObject<Session | null>;
  rowsRef: MutableRefObject<BracketRow[]>;
  cbRef: MutableRefObject<BracketGestureCallbacks>;
  rowEls: MutableRefObject<Map<number, HTMLElement>>;
  memberEls: MutableRefObject<Map<number, HTMLElement>>;
  setDrag: (d: BracketDragState) => void;
}

const pidOf = (e: ReactPointerEvent): number => e.pointerId ?? 1;

function capture(el: HTMLElement | null, pointerId: number): void {
  try {
    el?.setPointerCapture?.(pointerId);
  } catch {
    /* jsdom, or a pointer already gone — the handlers still ride the element */
  }
}

function clearTimer(s: Session): void {
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
}

function begin(ctx: Ctx, e: ReactPointerEvent, next: Omit<Session, 'pointerId' | 'startX' | 'startY' | 'timer'>): void {
  if (ctx.session.current) return;
  ctx.session.current = { ...next, pointerId: pidOf(e), startX: e.clientX, startY: e.clientY, timer: null };
}

function finish(ctx: Ctx): void {
  const s = ctx.session.current;
  if (s) clearTimer(s);
  ctx.session.current = null;
  ctx.setDrag(IDLE);
}

function armLongPress(ctx: Ctx, itemIndex: number): void {
  const s = ctx.session.current;
  if (!s || !ctx.cbRef.current.onLongPress) return;
  s.timer = setTimeout(() => {
    const live = ctx.session.current;
    if (live && live.axis === 'none') {
      live.axis = 'abandoned';
      ctx.cbRef.current.onLongPress?.(itemIndex);
    }
  }, LONG_PRESS_MS);
}

function handleMove(ctx: Ctx, e: ReactPointerEvent): void {
  const s = ctx.session.current;
  if (!s || pidOf(e) !== s.pointerId || s.axis === 'abandoned') return;
  const dx = e.clientX - s.startX;
  const dy = e.clientY - s.startY;
  if (s.mode === 'row' && s.axis === 'none') {
    const axis = dragAxis(dx, dy);
    if (axis === 'none') return;
    clearTimer(s);
    const gesture = dx < 0 ? (s.partKey ? 'leave' : null) : s.joinKey ? 'join' : null;
    if (axis === 'vertical' || !gesture) {
      s.axis = 'abandoned'; // the scroll (or a direction with nothing behind it) wins
      return;
    }
    s.axis = 'active';
    capture(s.el, s.pointerId);
  }
  if (s.axis !== 'active' && s.mode === 'row') return;
  e.preventDefault();
  if (s.mode === 'notch') {
    ctx.setDrag({
      kind: 'group',
      anchor: s.itemIndex,
      itemIndexes: groupSpan(ctx.rowsRef.current, s.rowMids, s.rowIdx, e.clientY),
    });
  } else if (s.mode === 'end' && s.resize) {
    const diff = resizeDiff(ctx.rowsRef.current, s.rowMids, s.memberMids, s.resize.partKey, s.resize.edge, e.clientY);
    ctx.setDrag({ kind: 'resize', partKey: s.resize.partKey, edge: s.resize.edge, ...diff });
  } else if (s.partKey && dx < 0) {
    ctx.setDrag({ kind: 'leave', index: s.itemIndex, partKey: s.partKey, dx, past: -dx >= COMMIT_PX });
  } else if (s.joinKey && dx > 0) {
    ctx.setDrag({ kind: 'join', index: s.itemIndex, partKey: s.joinKey, dx, past: dx >= COMMIT_PX });
  }
}

function handleUp(ctx: Ctx, e: ReactPointerEvent): void {
  const s = ctx.session.current;
  if (!s || pidOf(e) !== s.pointerId) return;
  const cb = ctx.cbRef.current;
  const dx = e.clientX - s.startX;
  if (s.mode === 'notch') {
    const taken = groupSpan(ctx.rowsRef.current, s.rowMids, s.rowIdx, e.clientY);
    if (taken.length >= 2) cb.onGroup?.(taken);
  } else if (s.mode === 'end' && s.resize) {
    const diff = resizeDiff(ctx.rowsRef.current, s.rowMids, s.memberMids, s.resize.partKey, s.resize.edge, e.clientY);
    for (const i of diff.add) cb.onAddToPart?.(s.resize.partKey, i);
    for (const i of diff.remove) cb.onRemoveFromPart?.(s.resize.partKey, i);
  } else if (s.axis === 'active') {
    if (s.partKey && -dx >= COMMIT_PX) cb.onRemoveFromPart?.(s.partKey, s.itemIndex);
    else if (s.joinKey && dx >= COMMIT_PX) cb.onAddToPart?.(s.joinKey, s.itemIndex);
  }
  finish(ctx);
}

const rowSession = { mode: 'row' as const, resize: null, axis: 'none' as const, rowMids: [], memberMids: [] };

function buildProps(ctx: Ctx) {
  const handlers = {
    onPointerMove: (e: ReactPointerEvent) => handleMove(ctx, e),
    onPointerUp: (e: ReactPointerEvent) => handleUp(ctx, e),
    onPointerCancel: () => finish(ctx),
  };
  return {
    /** A member row inside an open bracket — drag left and it leaves. */
    memberProps: (partKey: string, itemIndex: number) => {
      if (!ctx.cbRef.current.onRemoveFromPart && !ctx.cbRef.current.onLongPress) return {};
      return {
        ...handlers,
        onPointerDown: (e: ReactPointerEvent) => {
          begin(ctx, e, {
            ...rowSession,
            el: e.currentTarget as HTMLElement,
            rowIdx: -1,
            itemIndex,
            partKey: ctx.cbRef.current.onRemoveFromPart ? partKey : null,
            joinKey: null,
          });
          armLongPress(ctx, itemIndex);
        },
      };
    },
    /** A loose row — drag right and it joins the bracket next door (when there is one). */
    rowProps: (rowIdx: number, itemIndex: number) => {
      const joinKey = ctx.cbRef.current.onAddToPart ? adjacentPartFor(ctx.rowsRef.current, rowIdx) : null;
      if (!joinKey && !ctx.cbRef.current.onLongPress) return {};
      return {
        ...handlers,
        onPointerDown: (e: ReactPointerEvent) => {
          begin(ctx, e, {
            ...rowSession,
            el: e.currentTarget as HTMLElement,
            rowIdx,
            itemIndex,
            partKey: null,
            joinKey,
          });
          armLongPress(ctx, itemIndex);
        },
      };
    },
    /** The dormant notch in a loose row's gutter — a dedicated handle, so it captures at once. */
    notchProps: (rowIdx: number, itemIndex: number) => {
      if (!ctx.cbRef.current.onGroup) return {};
      return {
        ...handlers,
        onPointerDown: (e: ReactPointerEvent) => {
          e.preventDefault();
          begin(ctx, e, {
            mode: 'notch',
            el: e.currentTarget as HTMLElement,
            rowIdx,
            itemIndex,
            partKey: null,
            joinKey: null,
            resize: null,
            axis: 'active',
            rowMids: collectMids(ctx.rowEls.current),
            memberMids: [],
          });
          capture(e.currentTarget as HTMLElement, pidOf(e));
          ctx.setDrag({ kind: 'group', anchor: itemIndex, itemIndexes: [itemIndex] });
        },
      };
    },
    /** Either end of an open bracket — the same handle that made it, now resizing it. */
    endProps: (partKey: string, edge: 'head' | 'tail') => {
      const cb = ctx.cbRef.current;
      if (!cb.onAddToPart && !cb.onRemoveFromPart) return {};
      return {
        ...handlers,
        onPointerDown: (e: ReactPointerEvent) => {
          e.preventDefault();
          begin(ctx, e, {
            mode: 'end',
            el: e.currentTarget as HTMLElement,
            rowIdx: -1,
            itemIndex: -1,
            partKey: null,
            joinKey: null,
            resize: { partKey, edge },
            axis: 'active',
            rowMids: collectMids(ctx.rowEls.current),
            memberMids: collectMids(ctx.memberEls.current),
          });
          capture(e.currentTarget as HTMLElement, pidOf(e));
        },
      };
    },
  };
}

export function useBracketGestures(rows: BracketRow[], callbacks: BracketGestureCallbacks = {}) {
  const [drag, setDrag] = useState<BracketDragState>(IDLE);
  const rowEls = useRef(new Map<number, HTMLElement>());
  const memberEls = useRef(new Map<number, HTMLElement>());
  const session = useRef<Session | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const ctx: Ctx = { session, rowsRef, cbRef, rowEls, memberEls, setDrag };

  const registerRow = (rowIdx: number) => (el: HTMLElement | null) => {
    if (el) rowEls.current.set(rowIdx, el);
    else rowEls.current.delete(rowIdx);
  };
  const registerMember = (itemIndex: number) => (el: HTMLElement | null) => {
    if (el) memberEls.current.set(itemIndex, el);
    else memberEls.current.delete(itemIndex);
  };

  return {
    drag,
    ...buildProps(ctx),
    registerRow,
    registerMember,
    enabled: {
      group: !!callbacks.onGroup,
      leave: !!callbacks.onRemoveFromPart,
      join: !!callbacks.onAddToPart,
      resize: !!(callbacks.onAddToPart || callbacks.onRemoveFromPart),
    },
  };
}

export type BracketGestures = ReturnType<typeof useBracketGestures>;
