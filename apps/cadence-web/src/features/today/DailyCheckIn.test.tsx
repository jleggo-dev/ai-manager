/**
 * The check-in's one button (owner, 2026-09-08: "there's no way to accept what I've chosen").
 * Its label is a router — which word it shows decides what the tap does — so it gets a table of
 * every state, and the commit itself is pinned: nothing is sent on a pick, one request on the
 * button, and only a steer routes to the coach.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const sendDailyCheckin = vi.fn();
vi.mock('../../lib/api.ts', () => ({
  sendDailyCheckin: (...a: unknown[]) => sendDailyCheckin(...a),
}));
vi.mock('../../lib/query/index.ts', () => ({ useDailyCheckinDue: () => true }));
vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => <span /> }));

const { DailyCheckIn } = await import('./DailyCheckIn.tsx');
const { commitLabel } = await import('./checkinCommit.ts');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount() {
  const onAdjust = vi.fn();
  const onCoach = vi.fn();
  const onClose = vi.fn();
  render(<DailyCheckIn onAdjust={onAdjust} onCoach={onCoach} onClose={onClose} />);
  return { onAdjust, onCoach, onClose };
}

describe('commitLabel — the one button', () => {
  it.each([
    [null, null, 'Not now — take me to today'],
    [4, null, 'Done'],
    [null, 'keep', 'Done'],
    [2, 'keep', 'Done'],
    [null, 'lighter', 'Next'],
    [1, 'lighter', 'Next'],
  ] as const)('mood %s + adjustment %s → "%s"', (mood, picked, label) => {
    expect(commitLabel(mood, picked)).toBe(label);
  });
});

describe('DailyCheckIn', () => {
  it('offers no sub-line under any option, and never offers "Shift evenings earlier"', () => {
    mount();
    expect(screen.getByText('Keep the week as is')).toBeInTheDocument();
    expect(screen.getByText('Make it lighter')).toBeInTheDocument();
    expect(screen.queryByText(/Shift evenings/)).toBeNull();
    expect(screen.queryByText(/blip/)).toBeNull();
    expect(screen.queryByText(/Trim a session/)).toBeNull();
    expect(screen.queryByText(/in your own words/)).toBeNull();
  });

  it('with nothing picked, the button is "Not now" and dismisses', () => {
    const { onClose, onAdjust } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Not now — take me to today' }));
    expect(sendDailyCheckin).toHaveBeenCalledWith({ dismissed: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdjust).not.toHaveBeenCalled();
  });

  it('a pick sends nothing until the button; "Keep the week as is" ends with Done', () => {
    const { onClose, onAdjust } = mount();
    fireEvent.click(screen.getByRole('radio', { name: 'GOOD' }));
    fireEvent.click(screen.getByText('Keep the week as is'));
    expect(sendDailyCheckin).not.toHaveBeenCalled();
    expect(screen.queryByText('Not now — take me to today')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(sendDailyCheckin).toHaveBeenCalledTimes(1);
    expect(sendDailyCheckin).toHaveBeenCalledWith({ mood: 4, adjustment: 'keep' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdjust).not.toHaveBeenCalled();
  });

  it('"Make it lighter" reads Next and hands its exact steer to the coach', () => {
    const { onClose, onAdjust } = mount();
    fireEvent.click(screen.getByText('Make it lighter'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(sendDailyCheckin).toHaveBeenCalledWith({ mood: null, adjustment: 'lighter' });
    expect(onAdjust).toHaveBeenCalledWith(
      'Make the rest of this week lighter — trim one session and make another optional.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a mood on its own is a Done', () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('radio', { name: 'ROUGH' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(sendDailyCheckin).toHaveBeenCalledWith({ mood: 1, adjustment: null });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tapping a pick again clears it, and the button goes back to Not now', () => {
    mount();
    fireEvent.click(screen.getByText('Make it lighter'));
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Make it lighter'));
    expect(screen.getByRole('button', { name: 'Not now — take me to today' })).toBeInTheDocument();
  });
});
