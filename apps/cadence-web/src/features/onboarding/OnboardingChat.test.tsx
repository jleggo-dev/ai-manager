import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { COACH_PICKS_FENCE, OPENING_PICKS, OPENING_PLACEHOLDER, OPENING_QUESTION } from '@cadence/shared';
import { OnboardingChat } from './OnboardingChat.tsx';

const sendCoachMessage = vi.fn();
const openCoachSession = vi.fn();
const getReview = vi.fn();
const getPendingChange = vi.fn();

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
  // Chat-open health refresh (jsdom health capability is unavailable, so these stay unhit —
  // defined only so the mount effect can import them).
  getHealthDigest: vi.fn().mockResolvedValue({ digest: null, created_at: null }),
  postHealthDigest: vi.fn().mockResolvedValue(true),
  postWorkoutHistory: vi.fn().mockResolvedValue(true),
  // The change card now mounts on every finished last turn and asks the server what is pending
  // (it renders nothing when the answer is nothing) — so these must exist even in a chat test
  // that never proposes a change. That is the point of the redesign: the card follows the stored
  // proposal, not a tag in her prose.
  getPendingChange: (...args: unknown[]) => getPendingChange(...args),
  dismissPendingChange: vi.fn().mockResolvedValue(true),
  lockPlan: vi.fn().mockResolvedValue({ status: 200, body: {} }),
  notifyOnCoachReply: vi.fn().mockResolvedValue(true),
  stopCoachTurn: vi.fn().mockResolvedValue(true),
}));

// The Web Speech API isn't in jsdom; stub the mic so its empty-field state is deterministic
// without depending on browser feature detection.
vi.mock('../../components/MicButton.tsx', () => ({
  MicButton: () => <button aria-label="Dictate">mic</button>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getPendingChange.mockResolvedValue(null);
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

    fireEvent.change(screen.getByPlaceholderText(OPENING_PLACEHOLDER), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/what would you like to work on next/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A steadier mind' })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(COACH_PICKS_FENCE))).not.toBeInTheDocument();
  });

  /**
   * The specifics the broad options can't carry. A tappable "I have a half-marathon in July" would
   * be a lie for whoever taps it without one — a placeholder shows the standard without asserting
   * it. It belongs to the opening question alone: once she is asking real questions, an example of
   * a GOAL would be modelling an answer to the wrong thing.
   */
  it('models a specific answer on the opening turn, then gets out of the way', async () => {
    render(<OnboardingChat />);
    await screen.findByText(OPENING_QUESTION);
    expect(screen.getByPlaceholderText(OPENING_PLACEHOLDER)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(OPENING_PLACEHOLDER), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByPlaceholderText('Message your coach…')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(OPENING_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('never models a goal in the ongoing Coach tab', async () => {
    render(<OnboardingChat chrome="none" intent="ongoing" />);
    await screen.findByText(/good to see you/);
    expect(screen.getByPlaceholderText('Message your coach…')).toBeInTheDocument();
  });

  it("reports the coach's own read of how far through intake she is", async () => {
    render(<OnboardingChat />);
    await screen.findByText(OPENING_QUESTION);
    // The opening turn carries its own progress; the coach's reply supersedes it.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');

    fireEvent.change(screen.getByPlaceholderText(OPENING_PLACEHOLDER), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20'));
  });

  it('composes picks into the composer as plain words, and does not send them', async () => {
    render(<OnboardingChat />);
    await screen.findByText(OPENING_QUESTION);
    const sendsBefore = sendCoachMessage.mock.calls.length;

    // Driven off the real constants so a copy change to the opening options can never quietly
    // break composition — the wording is the owner's to change, the joining is ours to keep right.
    const [first, , third] = OPENING_PICKS.options;
    fireEvent.click(screen.getByRole('button', { name: first!.label }));
    fireEvent.click(screen.getByRole('button', { name: third!.label }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(OPENING_PLACEHOLDER)).toHaveValue(
        `${OPENING_PICKS.lead} ${first!.say} and ${third!.say}.`,
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
    fireEvent.change(screen.getByPlaceholderText(OPENING_PLACEHOLDER), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByPlaceholderText(/Cadence is replying/)).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    // Interrupting her is offered, not just implied — see A3.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();

    release!();
    await screen.findByPlaceholderText('Message your coach…');
  });

  it('shows the captures and the AI disclaimer in onboarding chrome, but not in tab chrome', async () => {
    getReview.mockResolvedValue({ goals: [{ goal_id: 'g1', title: 'Run a first 10k', area: 'movement' }] });
    const { unmount } = render(<OnboardingChat chrome="onboarding" />);
    expect(await screen.findByText(/tap to fix/i)).toBeInTheDocument();
    expect(screen.getByText(/double-check what I say/)).toBeInTheDocument();
    unmount();

    render(<OnboardingChat chrome="none" intent="ongoing" />);
    await screen.findByText(/good to see you/);
    expect(screen.queryByText(/tap to fix/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/double-check what I say/)).not.toBeInTheDocument();
  });

  /** The floating gear is GONE (owner, 2026-08-14): Settings lives in the bottom nav, and a
   *  second gear hovering over the conversation was chrome nobody asked for. */
  it('renders no floating settings gear in the chat', async () => {
    render(<OnboardingChat chrome="none" intent="ongoing" />);
    await screen.findByText(/good to see you/);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  /**
   * The pills used to open the pre-v2 curate wizard — the UI this redesign exists to replace —
   * which threw you out of the conversation mid-way and into a form. A tap now drafts the
   * correction into the composer, same contract as a quick pick: read it back, edit, send.
   */
  it('drafts a goal correction into the composer instead of opening the old wizard', async () => {
    getReview.mockResolvedValue({ goals: [{ goal_id: 'g1', title: 'Run a first 10k', area: 'movement' }] });
    render(<OnboardingChat />);

    const pill = await screen.findByRole('button', { name: /Run a first 10k/ });
    fireEvent.click(pill);

    await waitFor(() =>
      expect(screen.getByPlaceholderText(OPENING_PLACEHOLDER)).toHaveValue(
        'About "Run a first 10k" — that\'s not quite right. ',
      ),
    );
    expect(sendCoachMessage).not.toHaveBeenCalled();
  });

  /**
   * The bug this exists to prevent (2026-08-16, owner): she called propose_plan_change, the
   * proposal landed in the database with exactly the right content, she said "let me swap it
   * now" — and no card appeared, because the card was gated on her ALSO emitting a
   * `cadence-picks {"layout":"change"}` tag she had not emitted. Four turns of him asking her to
   * change his plan while she agreed and nothing happened.
   *
   * The card follows the stored proposal now. Her prose here contains no tag at all.
   */
  it('shows the change card from the stored proposal, with no tag in her reply', async () => {
    getPendingChange.mockResolvedValue({
      changes: ['Grip finisher: Dead hangs, not farmers carries'],
      activities: 15,
      created_at: '2026-08-16T13:26:10.389Z',
    });
    sendCoachMessage.mockImplementation(async (_s: string, _m: string, onDelta: (d: string) => void) => {
      onDelta('Let me swap it now.');
      return { completed: true };
    });

    render(<OnboardingChat />);
    await screen.findByText(OPENING_QUESTION);
    fireEvent.change(screen.getByPlaceholderText(OPENING_PLACEHOLDER), { target: { value: 'swap them' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/Dead hangs, not farmers carries/)).toBeInTheDocument();
  });

  it('shows no card when nothing is pending, rather than an empty frame', async () => {
    sendCoachMessage.mockImplementation(async (_s: string, _m: string, onDelta: (d: string) => void) => {
      onDelta('Sounds good.');
      return { completed: true };
    });

    render(<OnboardingChat />);
    await screen.findByText(OPENING_QUESTION);
    fireEvent.change(screen.getByPlaceholderText(OPENING_PLACEHOLDER), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Sounds good.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });
});
