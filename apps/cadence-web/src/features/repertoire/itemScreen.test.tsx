/**
 * The item, opened (P2) — every button on the screen, positive and near-miss: rename saves and
 * preserves the id; a blank name cannot be saved; the standing control posts the exact schema
 * word for each of the four taps; tempo has no input anywhere on the screen; Remove asks before
 * it deletes, and backs off on Cancel; the collision card appears only when the caller says one
 * exists. `lib/api/repertoire-item.ts` is mocked — this pins the SCREEN's behaviour, not the
 * network (that is progress-extras-repertoire.test.ts's job, on the API side).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RepertoireItem } from '@cadence/shared';
import { ItemScreen, COLLISION_NOTICE } from './ItemScreen.tsx';
import { REMOVE_CONSEQUENCE } from './ItemRemove.tsx';

const patchRepertoireItem = vi.hoisted(() => vi.fn());
const deleteRepertoireItem = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/repertoire-item.ts', () => ({
  patchRepertoireItem: (...a: unknown[]) => patchRepertoireItem(...a),
  deleteRepertoireItem: (...a: unknown[]) => deleteRepertoireItem(...a),
}));

function item(over: Partial<RepertoireItem> = {}): RepertoireItem {
  return {
    item_id: 'it-1',
    user_id: 'u1',
    goal_id: 'g-piano',
    label: 'Clair de lune',
    status: 'known',
    kind: 'piece',
    meta: { composer: 'Debussy' },
    started_at: '2026-01-05T09:00:00Z',
    learned_at: '2026-03-14T09:00:00Z',
    last_practiced_at: '2026-08-29T18:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  patchRepertoireItem.mockReset();
  deleteRepertoireItem.mockReset();
  vi.restoreAllMocks();
});

describe('rename', () => {
  it('saves and preserves the id — the write targets the row, never the label', async () => {
    const user = userEvent.setup();
    const saved = item({ label: 'Clair de lune (easier arrangement)' });
    patchRepertoireItem.mockResolvedValue(saved);
    render(<ItemScreen item={item()} onBack={() => {}} />);

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Clair de lune (easier arrangement)');
    await user.click(screen.getByRole('button', { name: 'Save the name' }));

    expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', {
      label: 'Clair de lune (easier arrangement)',
      composer: 'Debussy',
    });
    expect(await screen.findByText('Clair de lune (easier arrangement)')).toBeInTheDocument();
  });

  it('renders the reassurance sentence under the name fields, verbatim', () => {
    render(<ItemScreen item={item()} onBack={() => {}} />);
    expect(
      screen.getByText('Whatever you call it, it keeps its sessions, tempo and dates. Only the words change.'),
    ).toBeInTheDocument();
  });

  it('a blank name cannot be saved — the button stays disabled, near-miss for "saves anything"', async () => {
    const user = userEvent.setup();
    render(<ItemScreen item={item()} onBack={() => {}} />);
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    expect(screen.getByRole('button', { name: 'Save the name' })).toBeDisabled();
    expect(patchRepertoireItem).not.toHaveBeenCalled();
  });

  it("a rename collision surfaces the server's own message rather than a generic failure", async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockRejectedValue(new Error('"Clair de lune" already has this name'));
    render(<ItemScreen item={item()} onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Save the name' }));
    expect(await screen.findByText('"Clair de lune" already has this name')).toBeInTheDocument();
  });
});

describe('standing control', () => {
  it('posts the exact schema word for each of the four taps, never the button label', async () => {
    const user = userEvent.setup();
    const table: Array<[string, RepertoireItem['status']]> = [
      ['Up next', 'queued'],
      ['Learning', 'working'],
      ['Keeping up', 'known'],
      ['Learned', 'retired'],
    ];
    for (const [buttonLabel, status] of table) {
      patchRepertoireItem.mockReset();
      patchRepertoireItem.mockResolvedValue(item({ status }));
      // Start from a DIFFERENT standing than the one under test — the control is a no-op when
      // you tap the standing it is already showing, which would otherwise make this loop pass
      // for the wrong reason on the one row whose target happens to equal a fixed starting point.
      const startingStatus = status === 'working' ? 'queued' : 'working';
      const { unmount } = render(<ItemScreen item={item({ status: startingStatus })} onBack={() => {}} />);
      await user.click(screen.getByRole('button', { name: buttonLabel }));
      expect(patchRepertoireItem).toHaveBeenCalledWith('it-1', { status });
      unmount();
    }
  });

  it('shows what the chosen standing means, and updates the line when a different one is tapped', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockResolvedValue(item({ status: 'retired' }));
    render(<ItemScreen item={item({ status: 'known' })} onBack={() => {}} />);
    expect(screen.getByText(/in the rotation/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Learned' }));
    expect(await screen.findByText(/I won't schedule it again/i)).toBeInTheDocument();
  });

  it('reverts to the last-confirmed standing when the write fails, and says so', async () => {
    const user = userEvent.setup();
    patchRepertoireItem.mockRejectedValue(new Error('network down'));
    render(<ItemScreen item={item({ status: 'known' })} onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Learned' }));
    expect(await screen.findByText('network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keeping up' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Learned' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('tempo — read-only', () => {
  it('renders the settled tempo as text, with no input anywhere on the screen for it', () => {
    render(
      <ItemScreen item={item({ meta: { composer: 'Debussy', tempo_bpm: 60, tempo_meter: 4 } })} onBack={() => {}} />,
    );
    // The header caption ALSO carries a compact "♩ = 60" — this checks the full read-only
    // sentence in the TEMPO section specifically, which is unique to it.
    expect(screen.getByText(/settled from your metronome · changes when you play, not here/)).toBeInTheDocument();
    // The only inputs on the whole screen are the four name fields — none of them tempo.
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(4);
    for (const el of inputs) expect(el).not.toHaveDisplayValue(/60/);
  });

  it('the tempo section is absent entirely when no tempo is on file', () => {
    render(<ItemScreen item={item({ meta: { composer: 'Debussy' } })} onBack={() => {}} />);
    expect(screen.queryByText(/♩/)).not.toBeInTheDocument();
  });
});

describe('remove', () => {
  it('asks before it deletes, and does nothing on Cancel', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDeleted = vi.fn();
    render(<ItemScreen item={item()} onBack={() => {}} onDeleted={onDeleted} />);
    await user.click(screen.getByRole('button', { name: 'Remove from my list' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(deleteRepertoireItem).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('deletes and reports back once confirmed', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteRepertoireItem.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    render(<ItemScreen item={item()} onBack={() => {}} onDeleted={onDeleted} />);
    await user.click(screen.getByRole('button', { name: 'Remove from my list' }));
    expect(deleteRepertoireItem).toHaveBeenCalledWith('it-1');
    expect(await vi.waitFor(() => onDeleted)).toHaveBeenCalledWith('it-1');
  });

  it('states the consequence at the point of choice, visible before any tap', () => {
    render(<ItemScreen item={item()} onBack={() => {}} />);
    expect(screen.getByText(REMOVE_CONSEQUENCE)).toBeInTheDocument();
  });

  it('a failed delete reports the fault and never calls onDeleted', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteRepertoireItem.mockRejectedValue(new Error('server is down'));
    const onDeleted = vi.fn();
    render(<ItemScreen item={item()} onBack={() => {}} onDeleted={onDeleted} />);
    await user.click(screen.getByRole('button', { name: 'Remove from my list' }));
    expect(await screen.findByText('server is down')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('the collision card', () => {
  it('appears, naming the other piece, only when the caller says one collides', () => {
    render(<ItemScreen item={item()} collidesWithLabel="Clair de lune (reprise)" onBack={() => {}} />);
    expect(screen.getByText(COLLISION_NOTICE)).toBeInTheDocument();
    expect(screen.getByText(/Clair de lune \(reprise\)/)).toBeInTheDocument();
  });

  it('is absent for the ordinary case — no collision given', () => {
    render(<ItemScreen item={item()} onBack={() => {}} />);
    expect(screen.queryByText(COLLISION_NOTICE)).not.toBeInTheDocument();
  });

  it('is absent when the caller explicitly says null, same as undefined', () => {
    render(<ItemScreen item={item()} collidesWithLabel={null} onBack={() => {}} />);
    expect(screen.queryByText(COLLISION_NOTICE)).not.toBeInTheDocument();
  });
});
