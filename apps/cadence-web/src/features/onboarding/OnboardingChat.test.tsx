import type { ReactElement } from 'react';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COACH_PICKS_FENCE, OPENING_PICKS, OPENING_PLACEHOLDER, OPENING_QUESTION } from '@cadence/shared';
import { OnboardingChat } from './OnboardingChat.tsx';

// LayoutProposalCard (the third pending-turn card, mounted unconditionally beside
// ChangeCard/WeekReviewCard below) reads through `useProgressLayoutDraft`, a real `useQuery` —
// unlike its siblings' plain fetch-on-mount. Every render needs a QueryClientProvider now; one
// shared wrapper here keeps all the existing call sites below unchanged, `rerender` included.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return {
    ...result,
    rerender: (nextUi: ReactElement) =>
      result.rerender(<QueryClientProvider client={client}>{nextUi}</QueryClientProvider>),
  };
}

const sendCoachMessage = vi.fn();
const openCoachSession = vi.fn();
const getReview = vi.fn();
const getPendingChange = vi.fn();
const getCurrentCoach = vi.fn();

// Written the way a session that opened before the protocol changed still writes it — `layout` and
// all. Those sessions keep the instructions they were born with, so the field has to parse as
// content and the shape has to be derived anyway.
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
  getCurrentCoach: (...args: unknown[]) => getCurrentCoach(...args),
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
  // ChangeCard now ALSO reads the per-item detail to decide which branch to render (Show me vs
  // inline Apply) — default "nothing pending" here too, same reasoning as getPendingChange.
  getPendingChangeDetail: vi.fn().mockResolvedValue({ plan_version: null, items: [] }),
  dismissPendingChange: vi.fn().mockResolvedValue(true),
  lockPlan: vi.fn().mockResolvedValue({ status: 200, body: {} }),
  // The week-review card now mounts on every finished last turn too, same reasoning as
  // getPendingChange above — it must exist even in a chat test that never calls
  // open_week_review, and its default answer is "nothing pending" so the card renders nothing.
  getPendingWeekReview: vi.fn().mockResolvedValue(null),
  dismissPendingWeekReview: vi.fn().mockResolvedValue(true),
  // LayoutProposalCard, third sibling — same reasoning again: it mounts on every finished last
  // turn and reads the draft through the query hook, so this must exist even in a chat test that
  // never proposes a layout. Default "nothing pending" so the card renders nothing.
  getProgressLayoutDraft: vi.fn().mockResolvedValue(null),
  commitProgressLayoutDraft: vi.fn().mockResolvedValue(true),
  dismissProgressLayoutDraft: vi.fn().mockResolvedValue(true),
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
  getCurrentCoach.mockResolvedValue({ sessionId: null, messages: [] });
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

  /**
   * A retired thread used to leave the Coach tab EMPTY — the owner hit it after a deliberate
   * thread retirement (2026-08-20) and called it a big missing component. The transcript now
   * stays on screen read-only, under a quiet divider that says where the fresh start begins.
   * "stale" is a wire word; it never reaches the screen.
   */
  it('keeps a retired conversation on screen, read-only, above the fresh start', async () => {
    getCurrentCoach.mockResolvedValue({
      sessionId: 'old-thread',
      stale: true,
      staleReason: 'idle',
      messages: [
        { role: 'user', content: 'my knee was acting up' },
        {
          role: 'coach',
          content: `Noted — we plan around the knee.\n\`\`\`${COACH_PICKS_FENCE}\n${JSON.stringify(PICKS)}\n\`\`\``,
        },
      ],
    });
    render(<OnboardingChat chrome="none" intent="ongoing" />);

    // The old conversation is visible again…
    expect(await screen.findByText('my knee was acting up')).toBeInTheDocument();
    const oldReply = screen.getByText(/plan around the knee/);
    // …but read-only: its pick block neither renders as buttons nor leaks as JSON.
    expect(screen.queryByRole('button', { name: 'A steadier mind' })).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(COACH_PICKS_FENCE))).not.toBeInTheDocument();

    // The seam is explicit — and never wire vocabulary.
    const divider = screen.getByText(/earlier conversation — your next message starts fresh/);
    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument();

    // Order: old turns, then the divider, then the fresh conversation's greeting.
    const greeting = await screen.findByText(/good to see you/);
    expect(oldReply.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(greeting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Not adopted: the next send opens a brand-new session, never a resurrection of the thread.
    fireEvent.change(screen.getByPlaceholderText('Message your coach…'), { target: { value: 'hello again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(openCoachSession).toHaveBeenCalledTimes(1));
    expect(sendCoachMessage.mock.calls[0]![0]).toBe('test-session');
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

  /**
   * The build card is the one thing her block still declares, because it is an act rather than a
   * shape and nothing durable is stored for the client to follow instead: no declaration, no route
   * to a plan. So both spellings have to reach it — the one she is taught now, and the `confirm`
   * that every conversation open when the protocol changed is still sending.
   */
  it.each([
    ['the block she is taught now', '{"build":true,"progress":0.9}'],
    ["a live session's older confirm", '{"layout":"confirm","progress":0.9}'],
  ])('hands over the build card from %s', async (_case, json) => {
    getReview.mockResolvedValue({ name: 'Sam', goals: [], equipment: [], baseline: {} });
    sendCoachMessage.mockImplementation(async (_s: string, _m: string, onDelta: (d: string) => void) => {
      onDelta(`That is enough to build on.\n\`\`\`${COACH_PICKS_FENCE}\n${json}\n\`\`\``);
      return { completed: true };
    });

    render(<OnboardingChat onBuild={vi.fn()} />);
    await screen.findByText(OPENING_QUESTION);
    fireEvent.change(screen.getByPlaceholderText(OPENING_PLACEHOLDER), { target: { value: 'ready' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('button', { name: 'Build it' })).toBeInTheDocument();
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

/**
 * `autoSend` (check-in rebuild, step 4) — the end-of-trail card's "Start check-in" bridge. Unlike
 * `sessionNote`'s invisible nudge, the approved design shows this text as something the user
 * SAID: a real bubble, a real turn. These pin the three things that make an app-driven send safe
 * to fire from a component that never unmounts (MainTabs keeps the Coach tab alive at all times).
 */
describe('OnboardingChat autoSend', () => {
  it('delivers the text as a real, visible turn — a user bubble, then her reply', async () => {
    sendCoachMessage.mockImplementation(async (_id: string, _t: string, onDelta: (d: string) => void) => {
      onDelta("Let's see how the week went.");
      return { completed: true, responseId: null };
    });

    render(<OnboardingChat chrome="none" intent="ongoing" autoSend={{ text: 'Start my check-in', key: 1 }} />);

    expect(await screen.findByText('Start my check-in')).toBeInTheDocument();
    expect(await screen.findByText("Let's see how the week went.")).toBeInTheDocument();
    expect(sendCoachMessage).toHaveBeenCalledTimes(1);
    expect(sendCoachMessage.mock.calls[0]![1]).toBe('Start my check-in');
  });

  it('never re-fires the same key on a re-render, even with a brand-new object', async () => {
    sendCoachMessage.mockImplementation(async (_id: string, _t: string, onDelta: (d: string) => void) => {
      onDelta('Reply.');
      return { completed: true, responseId: null };
    });

    const { rerender } = render(
      <OnboardingChat chrome="none" intent="ongoing" autoSend={{ text: 'Start my check-in', key: 7 }} />,
    );
    await screen.findByText('Start my check-in');
    await waitFor(() => expect(sendCoachMessage).toHaveBeenCalledTimes(1));

    // A FRESH object carrying the same key — the shape a parent produces on every render once its
    // own state is set (an inline literal, never memoized), so this is the realistic re-render.
    rerender(<OnboardingChat chrome="none" intent="ongoing" autoSend={{ text: 'Start my check-in', key: 7 }} />);
    await screen.findByText('Reply.');

    expect(sendCoachMessage).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Start my check-in')).toHaveLength(1);
  });

  it('fires again for a NEW key — a later end-of-trail in the same still-mounted session', async () => {
    sendCoachMessage.mockImplementation(async (_id: string, _t: string, onDelta: (d: string) => void) => {
      onDelta('Reply.');
      return { completed: true, responseId: null };
    });

    const { rerender } = render(
      <OnboardingChat chrome="none" intent="ongoing" autoSend={{ text: 'Start my check-in', key: 1 }} />,
    );
    await screen.findByText('Start my check-in');
    await waitFor(() => expect(sendCoachMessage).toHaveBeenCalledTimes(1));

    rerender(<OnboardingChat chrome="none" intent="ongoing" autoSend={{ text: 'Start my check-in', key: 2 }} />);
    await waitFor(() => expect(sendCoachMessage).toHaveBeenCalledTimes(2));
  });

  /**
   * The known failure mode: a dead/stale session. `getCurrentCoach`'s SECOND call here is the
   * recovery poll `sendCoachMessage`'s dropped turn falls back to — answering `stale: true` is
   * recovery's own fast "this is not mine to adopt" exit (coach-recovery.ts), so the whole path
   * resolves in one poll instead of paying its patient multi-attempt real-time budget.
   */
  it('a dead/stale session leaves the text in the composer instead of losing it', async () => {
    getCurrentCoach
      .mockResolvedValueOnce({ sessionId: null, messages: [], stale: false }) // mount restore
      .mockResolvedValueOnce({ sessionId: 'sess-new', messages: [], stale: true }); // recovery poll
    sendCoachMessage.mockResolvedValueOnce({ completed: false, responseId: null });

    render(<OnboardingChat chrome="none" intent="ongoing" autoSend={{ text: 'Start my check-in', key: 1 }} />);

    await waitFor(() => expect(screen.getByPlaceholderText('Message your coach…')).toHaveValue('Start my check-in'), {
      timeout: 3000,
    });
  });
});
