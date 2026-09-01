/**
 * Screen 2 — "the tense" (Activity Builder 2A): past above present. Pins the parts a mount test
 * can't leave to inspection — the composed log text, the coach hand-off's seed sentence, the
 * now-menu's area filter, and the empty-menu no-heading rule (DoNowSection's own rule, reused).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const logAdhoc = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const getNowMenu = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('../../../lib/api.ts', () => ({
  logAdhoc: (...a: unknown[]) => logAdhoc(...a),
  getNowMenu: (...a: unknown[]) => getNowMenu(...a),
}));

// The walkthrough itself belongs to another agent's parcel — this test only needs to know
// QuickAddTense hands it the right item and reacts to its completion, so a stand-in that exposes
// both is enough; the real player is exercised by its own suite.
vi.mock('../../walkthrough/Walkthrough.tsx', () => ({
  Walkthrough: ({ title, onComplete }: { title: string; onComplete: () => void }) => (
    <div>
      <div>playing: {title}</div>
      <button onClick={onComplete}>Finish</button>
    </div>
  ),
}));

const { QuickAddTense } = await import('./QuickAddTense.tsx');

const nowItem = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  label: 'Easy 5k',
  area: 'movement',
  action: { kind: 'tool', tool: 'timer', params: { duration_min: 20 } },
  ...over,
});

type MountProps = {
  area?: 'movement' | 'practice';
  noun?: string;
  toward?: string;
  onBack?: () => void;
  onLogged?: () => void;
  onSteer?: (text: string) => void;
};

function mount(props: MountProps = {}) {
  return render(
    <QuickAddTense
      area={props.area ?? 'movement'}
      noun={props.noun ?? 'A workout'}
      toward={props.toward}
      onBack={props.onBack ?? (() => {})}
      onLogged={props.onLogged ?? (() => {})}
      onSteer={props.onSteer}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuickAddTense', () => {
  it('composes the log text from the noun and logs it under the right area', async () => {
    const onLogged = vi.fn();
    mount({ noun: 'Piano', area: 'practice', onLogged });
    fireEvent.click(screen.getByText('30 min'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('Piano — 30 min', undefined, 'practice'));
    expect(onLogged).toHaveBeenCalled();
  });

  it('strips the fallback noun’s article before composing the log text', async () => {
    mount({ noun: 'A workout', area: 'movement' });
    fireEvent.click(screen.getByText('45 min'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('Workout — 45 min', undefined, 'movement'));
  });

  it('the custom minutes field composes the same way as a chip', async () => {
    mount({ noun: 'Piano', area: 'practice' });
    fireEvent.change(screen.getByPlaceholderText('__ min'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Log it'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('Piano — 12 min', undefined, 'practice'));
  });

  it('the free-typed line logs exactly what was typed, untouched', async () => {
    mount({ noun: 'A workout', area: 'movement' });
    fireEvent.change(screen.getByPlaceholderText(/ran 5k/), { target: { value: 'hotel gym, 30 min' } });
    fireEvent.click(screen.getByText('Log'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('hotel gym, 30 min', undefined, 'movement'));
  });

  it('"Tell me instead" hands the coach a plain seed, movement and practice phrased differently', () => {
    const onSteer = vi.fn();
    mount({ noun: 'A workout', area: 'movement', onSteer });
    fireEvent.click(screen.getByLabelText('Tell me instead'));
    expect(onSteer).toHaveBeenCalledWith('I want to log a workout');

    cleanup();
    const onSteerPractice = vi.fn();
    mount({ noun: 'Piano', area: 'practice', onSteer: onSteerPractice });
    fireEvent.click(screen.getByLabelText('Tell me instead'));
    expect(onSteerPractice).toHaveBeenCalledWith('I want to log some piano time');
  });

  it('hides "Tell me instead" when the host has no door for it', () => {
    mount({ onSteer: undefined });
    expect(screen.queryByLabelText('Tell me instead')).toBeNull();
  });

  it('scopes the now-menu to this noun’s own area — a mind or nourishment row never shows', async () => {
    getNowMenu.mockResolvedValue([
      nowItem({ id: 'a', label: 'Easy 5k', area: 'movement' }),
      nowItem({ id: 'b', label: 'Three long exhales', area: 'mind' }),
      nowItem({ id: 'c', label: 'Log a snack', area: 'nourishment' }),
      nowItem({
        id: 'd',
        label: 'Deleted-activity row',
        area: 'movement',
        action: { kind: 'activity', activityId: 'x' },
      }),
    ]);
    mount({ area: 'movement', noun: 'A workout' });
    expect(await screen.findByText('Easy 5k')).toBeTruthy();
    expect(screen.queryByText('Three long exhales')).toBeNull();
    expect(screen.queryByText('Log a snack')).toBeNull();
    // Non-tool actions (an activity row) aren't playable here — DoNowSection drops them the same way.
    expect(screen.queryByText('Deleted-activity row')).toBeNull();
  });

  it('omits "Take me on one" entirely when nothing on the menu matches — no heading, no dead row', async () => {
    getNowMenu.mockResolvedValue([nowItem({ area: 'mind' })]);
    mount({ area: 'movement', noun: 'A workout' });
    await waitFor(() => expect(getNowMenu).toHaveBeenCalled());
    expect(screen.queryByText('Take me on one')).toBeNull();
  });

  it('playing a now-menu row through to completion logs it and closes, same as the chips', async () => {
    getNowMenu.mockResolvedValue([nowItem()]);
    const onLogged = vi.fn();
    mount({ area: 'movement', noun: 'A workout', onLogged });
    fireEvent.click(await screen.findByText('Easy 5k'));
    expect(screen.getByText('playing: Easy 5k')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish'));
    expect(onLogged).toHaveBeenCalled();
  });
});
