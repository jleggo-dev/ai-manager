import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COACH_PICKS_FENCE, OPENING_PICKS, OPENING_QUESTION } from '@cadence/shared';
import { OnboardingChat } from './OnboardingChat.tsx';

const sendCoachMessage = vi.fn();
const openCoachSession = vi.fn();
const getReview = vi.fn();

const PICKS = {
  layout: 'list',
  multi: true,
  lead: "I'd like to",
  progress: 0.2,
  options: [
    { label: 'Run a first 10k', say: 'run a first 10k', area: 'movement' },
    { label: 'A steadier mind', say: 'build a steadier mind', area: 'mind' },
  ],
};

const REPLY = `Good pair. So — what would you like to work on next?\n\n\`\`\`${COACH_PICKS_FENCE}\n${JSON.stringify(PICKS)}\n\`\`\``;

vi.mock('../../lib/api.ts', () => ({
  getCurrentCoach: vi.fn().mockResolvedValue({ sessionId: null, messages: [] }),
  getReview: (...args: unknown[]) => getReview(...args),
  openCoachSession: (...args: unknown[]) => openCoachSession(...args),
  sendCoachMessage: (...args: unknown[]) => sendCoachMessage(...args),
  prepareCoachFoodAction: vi.fn().mockResolvedValue({ status: 'ok', action: null }),
  getCoachFace: vi.fn().mockResolvedValue(null),
  setCoachFace: vi.fn().mockResolvedValue(null),
}));

// The Web Speech API isn't in jsdom; stub the mic so its empty-field state is deterministic
// without depending on browser feature detection.
vi.mock('../../components/MicButton.tsx', () => ({
  MicButton: () => <button aria-label="Dictate">mic</button>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getReview.mockResolvedValue({ goals: [] });
  openCoachSession.mockResolvedValue({ sessionId: 'test-session' });
  sendCoachMessage.mockImplementation(async (_id: string, _text: string, onDelta: (d: string) => void) => {
    onDelta(REPLY);
    return { completed: true, responseId: null };
  });
});

describe('OnboardingChat', () => {
  it("opens with the app's own question and picks, without asking the model anything", async () => {
    render(<OnboardingChat />);

    expect(await screen.findByText(OPENING_QUESTION)).toBeInTheDocument();
    for (const o of OPENING_PICKS.options) {
      expect(screen.getByRole('button', { name: o.label })).toBeInTheDocument();
    }
    // The whole point of making turn 1 deterministic: no round-trip before the user has acted.
    expect(sendCoachMessage).not.toHaveBeenCalled();
    expect(openCoachSession).not.toHaveBeenCalled();
  });

  it('renders the picks the coach ships with her reply, never the block itself', async () => {
    render(<OnboardingChat />);
    await screen.findByText(OPENING_QUESTION);

    fireEvent.change(screen.getByPlaceholderText('Message your coach…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/what would you like to work on next/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A steadier mind' })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(COACH_PICKS_FENCE))).not.toBeInTheDocument();
  });

  it("reports the coach's own read of how far through intake she is", async () => {
    render(<OnboardingChat />);
    await screen.findByText(OPENING_QUESTION);
    // The opening turn carries its own progress; the coach's reply supersedes it.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');

    fireEvent.change(screen.getByPlaceholderText('Message your coach…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20'));
  });

  it('composes picks into the composer as plain words, and does not send them', async () => {
    render(<OnboardingChat />);
    await screen.findByText(OPENING_QUESTION);
    const sendsBefore = sendCoachMessage.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Run a first 10k' }));
    fireEvent.click(screen.getByRole('button', { name: 'A steadier mind' }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Message your coach…')).toHaveValue(
        "I'd like to run a first 10k and build a steadier mind.",
      ),
    );
    expect(sendCoachMessage.mock.calls.length).toBe(sendsBefore);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('locks the composer while Cadence is replying', async () => {
    let release: (() => void) | null = null;
    sendCoachMessage.mockImplementationOnce(
      (_id: string, _t: string, onDelta: (d: string) => void) =>
        new Promise((resolve) => {
          release = () => {
            onDelta(REPLY);
            resolve({ completed: true, responseId: null });
          };
        }),
    );
    render(<OnboardingChat />);
    await screen.findByText(OPENING_QUESTION);
    fireEvent.change(screen.getByPlaceholderText('Message your coach…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByPlaceholderText('Cadence is replying…')).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();

    release!();
    await screen.findByPlaceholderText('Message your coach…');
  });

  it('shows the captures and the AI disclaimer in onboarding chrome, but not in tab chrome', async () => {
    getReview.mockResolvedValue({ goals: [{ goal_id: 'g1', title: 'Run a first 10k', area: 'movement' }] });
    const { unmount } = render(<OnboardingChat chrome="onboarding" onReview={() => {}} />);
    expect(await screen.findByText(/tap to fix/i)).toBeInTheDocument();
    expect(screen.getByText(/double-check what I say/)).toBeInTheDocument();
    unmount();

    render(<OnboardingChat chrome="none" intent="ongoing" />);
    await screen.findByText(/good to see you/);
    expect(screen.queryByText(/tap to fix/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/double-check what I say/)).not.toBeInTheDocument();
  });

  it('renders a floating settings gear only when onSettings is provided', async () => {
    const { unmount } = render(<OnboardingChat chrome="none" intent="ongoing" onSettings={() => {}} />);
    await screen.findByText(/good to see you/);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    unmount();

    render(<OnboardingChat chrome="none" intent="ongoing" />);
    await screen.findByText(/good to see you/);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
