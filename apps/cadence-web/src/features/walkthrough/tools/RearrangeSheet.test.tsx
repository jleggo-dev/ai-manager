/**
 * The Rearrange sheet (walkthrough v3 Phase 6, design C): every button, and the two drags. Pick
 * two groups and the preview is one dashed group whose pills reorder as the toggle flips; Combine
 * commits with a toast and its Undo; Split undoes a combine; drag a pill into a gap and that set
 * is on its own there; Undo walks back; Done hands the shape out; Close hands out nothing.
 * Nothing is marked "moved".
 */
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { type PlayedShape, type WalkthroughStep, defaultShape } from '@cadence/shared';
import { RearrangeSheet } from './RearrangeSheet.tsx';

const steps: WalkthroughStep[] = [
  { id: 's1', title: 'Pull-ups', minutes: 6, tool: { kind: 'reps', sets: 3, reps: 5 }, skippable: true },
  { id: 's2', title: 'Farmer carry', minutes: 6, tool: { kind: 'timer', seconds: 45, sets: 3 }, skippable: true },
  { id: 's3', title: 'Hip thrust', minutes: 4, tool: { kind: 'reps', sets: 3, reps: 12 }, skippable: true },
  { id: 's4', title: 'Dead hang', minutes: 3, tool: { kind: 'timer', seconds: 45, sets: 3 }, skippable: true },
  {
    id: 's5',
    title: 'Abs circuit',
    minutes: 8,
    tool: { kind: 'circuit', rounds: 3, exercises: [{ name: 'Plank', seconds: 30 }] },
    skippable: true,
  },
];

const press = (label: string | RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));
const pick = (title: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Pick ${title}` }));
const sheet = () => within(screen.getByRole('dialog', { name: 'Rearrange' }));
const pillsOf = (title: string) => {
  const row =
    screen.getByText(title).closest('[data-row]') ??
    screen.getByText(title).parentElement?.parentElement?.parentElement;
  return within(row as HTMLElement)
    .getAllByText(/^(Pull-up 5|Hang 45 s|Carry|Thrust|Pull-up|Hang|Carry 45 s|Thrust 12|1 moves × 3 rounds)$/)
    .map((el) => el.textContent);
};

function mount(shape: PlayedShape = defaultShape(steps)) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(<RearrangeSheet steps={steps} shape={shape} onDone={onDone} onClose={onClose} />);
  return { onDone, onClose };
}

afterEach(cleanup);

describe('Rearrange — pick, preview, Combine', () => {
  it('lists every row as a group with its pills, and a circuit or read has no pick circle', () => {
    mount();
    expect(sheet().getByText('Pull-ups')).toBeInTheDocument();
    expect(sheet().getAllByText('Pull-up 5')).toHaveLength(3);
    expect(sheet().getByText('3 rounds')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Pick Abs circuit' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Pick Pull-ups' })).toBeInTheDocument();
    expect(screen.queryByText(/moved/i)).toBeNull();
  });

  it('one pick shows no tray; two picks preview ONE group and the tray; the toggle reorders the pills live', () => {
    mount();
    pick('Farmer carry');
    expect(screen.queryByRole('button', { name: 'Combine' })).toBeNull();
    pick('Hip thrust');
    expect(sheet().getByText('Farmer carry + hip thrust')).toBeInTheDocument();
    expect(sheet().getByText('6 sets')).toBeInTheDocument();
    expect(sheet().queryByText('Hip thrust')).toBeNull(); // the second row folded into the preview
    expect(pillsOf('Farmer carry + hip thrust')).toEqual(['Carry', 'Thrust', 'Carry', 'Thrust', 'Carry', 'Thrust']);
    expect(screen.getByRole('radio', { name: 'Alternate' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Sequence' }));
    expect(pillsOf('Farmer carry + hip thrust')).toEqual(['Carry', 'Carry', 'Carry', 'Thrust', 'Thrust', 'Thrust']);
    // Picking a third replaces the earlier pick: still two.
    pick('Pull-ups');
    expect(sheet().getByText('Pull-ups + hip thrust')).toBeInTheDocument(); // the earlier row's place
  });

  it('Combine commits the group with Split, a toast, and its Undo puts the two rows back', () => {
    mount();
    pick('Farmer carry');
    pick('Hip thrust');
    press('Combine');
    expect(screen.getByRole('status')).toHaveTextContent('Farmer carry and hip thrust now alternate.');
    expect(screen.getByRole('button', { name: 'Split' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Combine' })).toBeNull();
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(sheet().getByText('Hip thrust')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Split' })).toBeNull();
  });

  it('Sequence then Combine says so', () => {
    mount();
    pick('Farmer carry');
    pick('Hip thrust');
    fireEvent.click(screen.getByRole('radio', { name: 'Sequence' }));
    press('Combine');
    expect(screen.getByRole('status')).toHaveTextContent('Farmer carry and hip thrust now run in sequence.');
  });

  it('Split takes a combined group back to its steps', () => {
    mount();
    pick('Farmer carry');
    pick('Hip thrust');
    press('Combine');
    press('Split');
    expect(sheet().getByText('Farmer carry')).toBeInTheDocument();
    expect(sheet().getByText('Hip thrust')).toBeInTheDocument();
    expect(screen.queryByText('Farmer carry + hip thrust')).toBeNull();
  });

  it('Done hands the shape out; Close hands out nothing', () => {
    const { onDone, onClose } = mount();
    pick('Farmer carry');
    pick('Hip thrust');
    press('Combine');
    press('Done');
    expect(onDone).toHaveBeenCalledTimes(1);
    const shape = onDone.mock.calls[0]![0] as PlayedShape;
    expect(shape.map((g) => g.turns.length)).toEqual([3, 6, 3, 1]);
    expect(shape[1]!.mode).toBe('alternate');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the header Undo walks every change back, and is quiet when there is nothing to undo', () => {
    const { onDone } = mount();
    const undo = () => fireEvent.click(sheet().getAllByRole('button', { name: 'Undo' })[0]!);
    expect(sheet().getAllByRole('button', { name: 'Undo' })[0]).toBeDisabled();
    pick('Farmer carry');
    pick('Hip thrust');
    press('Combine');
    undo();
    press('Done');
    expect((onDone.mock.calls[0]![0] as PlayedShape).map((g) => g.turns.length)).toEqual([3, 3, 3, 3, 1]);
  });
});

/** Rows laid out 60 px tall with an 8 px gap, so a y can name a gap. */
function layRowsOut() {
  const rows = screen.getAllByRole('dialog')[0]!.querySelectorAll<HTMLElement>('[data-row]');
  rows.forEach((el, i) => {
    el.getBoundingClientRect = () => ({
      top: i * 68,
      bottom: i * 68 + 60,
      left: 0,
      right: 375,
      width: 375,
      height: 60,
      x: 0,
      y: i * 68,
      toJSON: () => ({}),
    });
  });
}

describe('Rearrange — the drags', () => {
  it('a pill dragged into a gap leaves that set on its own there; the source reads one set fewer while it is lifted', () => {
    const { onDone } = mount();
    layRowsOut();
    const pill = screen.getAllByLabelText('Drag Hang 45 s')[0]!;
    fireEvent.pointerDown(pill, { clientX: 100, clientY: 220, pointerId: 1 });
    fireEvent.pointerMove(pill, { clientX: 100, clientY: 10, pointerId: 1 });
    // While lifted: the lifted pill under the thumb, a hole in the source, and the source counts two.
    expect(screen.getByText('2 sets')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Drag Hang 45 s')).toHaveLength(2);
    fireEvent.pointerUp(pill, { clientX: 100, clientY: 10, pointerId: 1 });
    press('Done');
    const shape = onDone.mock.calls[0]![0] as PlayedShape;
    expect(shape[0]).toMatchObject({ turns: [{ stepId: 's4', set: 0 }] });
    expect(shape.find((g) => g.turns.length === 2)?.turns.every((t) => t.stepId === 's4')).toBe(true);
    expect(screen.queryByText(/moved/i)).toBeNull();
  });

  it('a group dragged by its handle lands in the gap under the finger', () => {
    const { onDone } = mount();
    layRowsOut();
    const handle = screen.getByLabelText('Drag Dead hang');
    fireEvent.pointerDown(handle, { clientX: 340, clientY: 230, pointerId: 2 });
    fireEvent.pointerMove(handle, { clientX: 340, clientY: 70, pointerId: 2 }); // between rows 1 and 2
    fireEvent.pointerUp(handle, { clientX: 340, clientY: 70, pointerId: 2 });
    press('Done');
    const shape = onDone.mock.calls[0]![0] as PlayedShape;
    expect(shape.map((g) => g.turns[0]!.stepId)).toEqual(['s1', 's4', 's2', 's3', 's5']);
  });

  it('a drag let go where it started changes nothing', () => {
    const { onDone } = mount();
    layRowsOut();
    const handle = screen.getByLabelText('Drag Dead hang');
    fireEvent.pointerDown(handle, { clientX: 340, clientY: 230, pointerId: 3 });
    fireEvent.pointerMove(handle, { clientX: 340, clientY: 235, pointerId: 3 });
    fireEvent.pointerUp(handle, { clientX: 340, clientY: 235, pointerId: 3 });
    press('Done');
    expect((onDone.mock.calls[0]![0] as PlayedShape).map((g) => g.turns[0]!.stepId)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
    ]);
  });
});
