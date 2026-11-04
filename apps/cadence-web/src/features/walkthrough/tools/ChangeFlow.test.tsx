/**
 * "Change this move" (design A, board 1), both sheets through the flow that owns their reads. The
 * rows are a router: which show for a move with and without alternatives, with and without history,
 * what lands when the coach answers "Something else", and what the row says when she cannot be
 * reached. Faked: the two lib/api readers and the units read.
 */
import { screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionItemAlternative } from '@cadence/shared';
import { renderWithQuery } from '../../../test/withQuery.tsx';
import { ChangeFlow, type ChangeTarget } from './ChangeFlow.tsx';

const api = vi.hoisted(() => ({
  history: {} as Record<
    string,
    { date: string; sets?: number; reps?: number; seconds?: number; load?: string } | null | 'down'
  >,
  unit: 'lb' as 'lb' | 'kg',
  ask: vi.fn(),
}));
vi.mock('../../../lib/api.ts', () => ({
  getUnits: async () => ({ prefs: null, resolved: { body_weight: api.unit } }),
  getExerciseHistory: async ({ exercise }: { exercise: string }) => {
    const h = api.history[exercise.toLowerCase()];
    if (h === 'down') return { ok: false };
    return { ok: true, lines: h ? [{ activity: 'Obstacle strength', name: exercise, ...h }] : [] };
  },
  askAlternativeItem: (...a: unknown[]) => api.ask(...a),
}));

const thrust: SessionItemAlternative = {
  name: 'Kettlebell hip thrust',
  sets: 2,
  reps: 12,
  load: '40 lb',
  equipment: ['Bench', 'kettlebell'],
};
const clamshell: SessionItemAlternative = { name: 'Banded clamshell', sets: 2, reps: 15, equipment: ['Light band'] };
const single: SessionItemAlternative = { name: 'Single-leg glute bridge', sets: 2, reps: 10, equipment: [] };

const bridge: ChangeTarget = {
  name: 'Glute bridge',
  tool: { kind: 'reps', sets: 2, reps: 12, load: 'bodyweight' },
  alternatives: [single, thrust, clamshell],
  suggested_load: '15 lb',
  activity: 'Obstacle strength',
  subtitle: 'GLUTE BRIDGE · SET 1 OF 2 NEXT',
  targetWord: '12 reps',
};

const mount = (target: ChangeTarget, start: 'change' | 'weight' = 'change') => {
  const onSwap = vi.fn();
  const onUseLoad = vi.fn();
  const onClose = vi.fn();
  renderWithQuery(<ChangeFlow target={target} start={start} onSwap={onSwap} onUseLoad={onUseLoad} onClose={onClose} />);
  return { onSwap, onUseLoad, onClose };
};
const row = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

beforeEach(() => {
  api.history = {
    'single-leg glute bridge': { date: '2026-10-21', sets: 2, reps: 10 },
    'kettlebell hip thrust': { date: '2026-10-28', sets: 3, reps: 10, load: '25 lb' },
    'banded clamshell': null,
    'glute bridge': { date: '2026-10-28', sets: 2, reps: 12, load: 'bodyweight' },
  };
  api.unit = 'lb';
  api.ask.mockReset();
});
afterEach(cleanup);

describe('the Change sheet — which rows', () => {
  it('Add weight first, then her alternatives with name, target, equipment and history or New, then Something else', async () => {
    mount(bridge);
    expect(screen.getByText('Change this move')).toBeInTheDocument();
    expect(screen.getByText('GLUTE BRIDGE · SET 1 OF 2 NEXT')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(buttons[1]).toMatch(/^Add weight/);
    expect(buttons[2]).toMatch(/^Single-leg glute bridge/);
    expect(buttons[3]).toMatch(/^Kettlebell hip thrust/);
    expect(buttons[4]).toMatch(/^Banded clamshell/);
    expect(buttons[5]).toMatch(/^Something else/);
    expect(screen.getByText('Or swap for…')).toBeInTheDocument();

    expect(within(row('Kettlebell hip thrust')).getByText('12 × 40 lb · 2 sets')).toBeInTheDocument();
    expect(within(row('Kettlebell hip thrust')).getByText('Bench · kettlebell')).toBeInTheDocument();
    expect(within(row('Single-leg glute bridge')).getByText('No tools')).toBeInTheDocument();
    expect(within(row('Banded clamshell')).getByText('Light band')).toBeInTheDocument();

    await waitFor(() =>
      expect(within(row('Kettlebell hip thrust')).getByText('Last 3 × 10 · 25 lb · Oct 28')).toBeInTheDocument(),
    );
    expect(within(row('Single-leg glute bridge')).getByText('Last 2 × 10 · Oct 21')).toBeInTheDocument();
    expect(within(row('Banded clamshell')).getByText('New')).toBeInTheDocument();
  });

  it('no alternatives: Add weight and Something else, no "Or swap for…"', () => {
    mount({ ...bridge, alternatives: undefined });
    expect(screen.getByRole('button', { name: /Add weight/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Something else/ })).toBeInTheDocument();
    expect(screen.queryByText('Or swap for…')).toBeNull();
    expect(screen.queryByText('No tools')).toBeNull();
  });

  it('a move that takes no weight (a plain hold) has no Add weight row', () => {
    mount({ ...bridge, tool: { kind: 'timer', seconds: 300 } });
    expect(screen.queryByRole('button', { name: /Add weight/ })).toBeNull();
  });

  it('the move being played is not offered as a swap; a weight already on reads Change weight', () => {
    mount({
      ...bridge,
      name: 'Kettlebell hip thrust',
      tool: { kind: 'reps', sets: 2, reps: 12, load: '40 lb' },
      workingLoad: '45 lb',
    });
    expect(screen.queryByRole('button', { name: /^Kettlebell hip thrust/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Change weight/ })).toBeInTheDocument();
  });

  it('a history read that failed draws neither a last line nor New', async () => {
    api.history['banded clamshell'] = 'down';
    mount(bridge);
    await waitFor(() => expect(within(row('Kettlebell hip thrust')).getByText(/Last/)).toBeInTheDocument());
    expect(within(row('Banded clamshell')).queryByText('New')).toBeNull();
    expect(within(row('Banded clamshell')).queryByText(/Last/)).toBeNull();
  });

  it('draws no reason and no line explaining the sheet', () => {
    mount(bridge);
    expect(screen.queryByText(/because|tap a row|choose|pick one/i)).toBeNull();
  });
});

describe('the Change sheet — every button', () => {
  it('a swap row hands the alternative up', () => {
    const { onSwap } = mount(bridge);
    fireEvent.click(row('Kettlebell hip thrust'));
    expect(onSwap).toHaveBeenCalledWith(thrust);
  });

  it("Add weight opens the weight control with the suggestion and last time, in the person's unit; Use hands the load up", async () => {
    const { onUseLoad } = mount(bridge);
    fireEvent.click(row('Add weight'));
    expect(screen.getByText('Add weight')).toBeInTheDocument();
    expect(screen.getByText('GLUTE BRIDGE · 12 REPS')).toBeInTheDocument();
    // The dial opens on her suggestion.
    expect(screen.getByText('Use 15 lb')).toBeInTheDocument();
    expect(screen.getByText('my suggestion')).toBeInTheDocument();
    // "last time" waits for the read; the glute bridge was last done at bodyweight, which the dial cannot hold.
    await waitFor(() => expect(screen.queryByText(/last time/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /lb less/ }));
    fireEvent.click(screen.getByText('Use 12.5 lb'));
    expect(onUseLoad).toHaveBeenCalledWith('12.5 lb');
  });

  it('kg: the dial steps a kilo', async () => {
    api.unit = 'kg';
    mount({ ...bridge, suggested_load: undefined });
    fireEvent.click(row('Add weight'));
    fireEvent.click(await screen.findByRole('button', { name: '1 kg more' }));
    expect(screen.getByText('Use 1 kg')).toBeInTheDocument();
  });

  it('Back from the weight control returns to the sheet; opened straight on the weight control, Back closes', () => {
    const { onClose } = mount(bridge);
    fireEvent.click(row('Add weight'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Change this move' }));
    expect(screen.getByText('Change this move')).toBeInTheDocument();
    cleanup();
    const second = mount({ ...bridge, workingLoad: '15 lb' }, 'weight');
    expect(screen.getByText('Change weight')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Change this move' }));
    expect(second.onClose).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Something else: dots and "asking · ~20 s" while she looks, then her pick lands as a row above it', async () => {
    let answer: (v: unknown) => void = () => {};
    api.ask.mockReturnValue(new Promise((r) => (answer = r)));
    mount(bridge);
    fireEvent.click(row('Something else'));
    expect(screen.getByText('asking · ~20 s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Something else/ })).toHaveAttribute('aria-busy', 'true');
    const [ask] = api.ask.mock.calls[0]! as [
      { activity: string; item: Record<string, unknown>; alreadyOffered: string[] },
    ];
    expect(ask.activity).toBe('Obstacle strength');
    expect(ask.item).toEqual({ name: 'Glute bridge', sets: 2, reps: 12, load: 'bodyweight' });
    expect(ask.alreadyOffered).toEqual(
      expect.arrayContaining(['Single-leg glute bridge', 'Kettlebell hip thrust', 'Banded clamshell']),
    );

    answer({ ok: true, alternative: { name: 'Bridge march', sets: 2, reps: 20, equipment: [] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Bridge march/ })).toBeInTheDocument());
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const landed = buttons.findIndex((t) => t.startsWith('Bridge march'));
    const something = buttons.findIndex((t) => t.startsWith('Something else'));
    expect(landed).toBeGreaterThan(buttons.findIndex((t) => t.startsWith('Banded clamshell')));
    expect(landed).toBeLessThan(something);
    expect(screen.queryByText('asking · ~20 s')).toBeNull();
  });

  it('Something else for a circuit move sends the MOVE — its reps and load over the rounds — never the whole circuit', async () => {
    api.ask.mockResolvedValue({ ok: false, reason: 'unreachable' });
    mount({
      ...bridge,
      name: 'Glute bridge',
      tool: { kind: 'reps', sets: 3, reps: 12, load: '40 lb' }, // what changeTarget builds for a move in a 3-round circuit
      alternatives: undefined,
      subtitle: 'GLUTE BRIDGE · ROUND 2 OF 3',
    });
    fireEvent.click(row('Something else'));
    const [ask] = api.ask.mock.calls[0]! as [{ item: Record<string, unknown> }];
    expect(ask.item).toEqual({ name: 'Glute bridge', sets: 3, reps: 12, load: '40 lb' });
    await waitFor(() => expect(screen.getByText("Couldn't reach the coach — try again")).toBeInTheDocument());
  });

  it('a fault is one plain line on the row, and the row can be tapped again', async () => {
    api.ask.mockResolvedValue({ ok: false, reason: 'unreachable' });
    mount(bridge);
    fireEvent.click(row('Something else'));
    await waitFor(() => expect(screen.getByText("Couldn't reach the coach — try again")).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Something else/ })).not.toHaveAttribute('aria-busy', 'true');
    fireEvent.click(row('Something else'));
    expect(api.ask).toHaveBeenCalledTimes(2);
  });

  it('Close closes', () => {
    const { onClose } = mount(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
