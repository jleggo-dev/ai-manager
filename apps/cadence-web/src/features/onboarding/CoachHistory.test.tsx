import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OnboardingChat } from './OnboardingChat.tsx';
import { writeCachedTranscript } from './coach-transcript-cache.ts';

const getCurrentCoach = vi.fn();
const getEarlierCoachConversations = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getCurrentCoach: (...a: unknown[]) => getCurrentCoach(...a),
  getEarlierCoachConversations: (...a: unknown[]) => getEarlierCoachConversations(...a),
  getReview: vi.fn().mockResolvedValue({ goals: [] }),
  openCoachSession: vi.fn().mockResolvedValue({ sessionId: 'new' }),
  sendCoachMessage: vi.fn().mockResolvedValue({ completed: true, responseId: null }),
  prepareCoachFoodAction: vi.fn().mockResolvedValue({ status: 'ok', action: null }),
  getCoachFace: vi.fn().mockResolvedValue(null),
  setCoachFace: vi.fn().mockResolvedValue(null),
  getHealthDigest: vi.fn().mockResolvedValue({ digest: null, created_at: null }),
  postHealthDigest: vi.fn().mockResolvedValue(true),
  postWorkoutHistory: vi.fn().mockResolvedValue(true),
  getPendingChange: vi.fn().mockResolvedValue(null),
  // ChangeCard also reads the per-item detail now (to pick Show me vs inline Apply) — same
  // pre-existing-gap reasoning as getPendingWeekReview just below.
  getPendingChangeDetail: vi.fn().mockResolvedValue({ plan_version: null, items: [] }),
  dismissPendingChange: vi.fn().mockResolvedValue(true),
  lockPlan: vi.fn().mockResolvedValue({ status: 200, body: {} }),
  // The week-review card mounts on every finished last turn (same as getPendingChange above) —
  // it must exist even here, where nobody exercises it, or OnboardingChat's real render throws
  // reaching into a mock that never defined it. Pre-existing gap from the check-in rebuild's
  // step 6 merge (WeekReviewCard wired into OnboardingChat without every sibling mock catching
  // up); fixed here because it blocks this whole suite, not because this file exercises it.
  getPendingWeekReview: vi.fn().mockResolvedValue(null),
  dismissPendingWeekReview: vi.fn().mockResolvedValue(true),
  notifyOnCoachReply: vi.fn().mockResolvedValue(true),
  stopCoachTurn: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../components/MicButton.tsx', () => ({
  MicButton: () => <button aria-label="Dictate">mic</button>,
}));

const coachTab = () => render(<OnboardingChat intent="ongoing" chrome="none" />);

/**
 * The Coach tab as somebody with a HISTORY sees it: this conversation, and a way back to the ones
 * before it. Owner, 2026-08-20: *"my entire history of the chat is gone… I also need to remember
 * what we talked about and why."*
 */
describe('coach history in the Coach tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentCoach.mockResolvedValue({ ok: true, sessionId: null, messages: [] });
  });

  it('paints the conversation from the device before the server answers', async () => {
    writeCachedTranscript('sess-1', [{ role: 'coach', text: 'we talked about your knee' }]);
    // Never resolves: this is the slow-network case the cache exists for.
    getCurrentCoach.mockReturnValueOnce(new Promise(() => {}));

    coachTab();
    // No findBy — it has to be on screen already, not "eventually".
    expect(screen.getByText('we talked about your knee')).toBeInTheDocument();
  });

  it('offers no way back when this is the only conversation there has ever been', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      messages: [{ role: 'coach', content: 'how did the week go?' }],
      startedAt: '2026-08-19T10:00:00Z',
      hasEarlier: false,
    });
    coachTab();
    await screen.findByText('how did the week go?');
    expect(screen.queryByRole('button', { name: /earlier conversations/i })).not.toBeInTheDocument();
  });

  it('reads back one conversation at a time, dated, above the one on screen', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      messages: [{ role: 'coach', content: 'how did the week go?' }],
      startedAt: '2026-08-19T10:00:00Z',
      hasEarlier: true,
    });
    getEarlierCoachConversations.mockResolvedValueOnce({
      conversations: [
        {
          sessionId: 'sess-0',
          startedAt: '2026-08-12T09:00:00Z',
          lastActiveAt: '2026-08-12T09:30:00Z',
          turns: [{ role: 'coach', content: 'we agreed on three runs a week' }],
          truncated: false,
        },
      ],
      hasMore: false,
      nextBefore: '2026-08-12T09:00:00Z',
    });

    coachTab();
    await screen.findByText('how did the week go?');
    fireEvent.click(await screen.findByRole('button', { name: /earlier conversations/i }));

    expect(await screen.findByText('we agreed on three runs a week')).toBeInTheDocument();
    expect(getEarlierCoachConversations).toHaveBeenCalledWith('2026-08-19T10:00:00Z', 1);
    // The date the conversation happened, so reading back places it in their week. Asserted on the
    // parts rather than the ordering — the label is locale-formatted, and the runner's locale is
    // not the user's.
    const divider = screen.getAllByRole('separator').at(-1)!;
    expect(divider.textContent).toMatch(/Wednesday/);
    expect(divider.textContent).toMatch(/August/);
    expect(divider.textContent).toMatch(/12/);
    // Nothing further back: the control retires rather than sitting there doing nothing.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /earlier conversations/i })).not.toBeInTheDocument(),
    );
  });

  it('never loads the archive just because the tab opened', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      messages: [{ role: 'coach', content: 'how did the week go?' }],
      startedAt: '2026-08-19T10:00:00Z',
      hasEarlier: true,
    });
    coachTab();
    await screen.findByText('how did the week go?');
    await screen.findByRole('button', { name: /earlier conversations/i });
    // The offer is on screen; nothing behind it has been fetched. This is the latency contract:
    // opening Coach costs exactly what it did before history existed.
    expect(getEarlierCoachConversations).not.toHaveBeenCalled();
  });

  it('says so when an archived thread was too long to ship whole', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      messages: [{ role: 'coach', content: 'how did the week go?' }],
      startedAt: '2026-08-19T10:00:00Z',
      hasEarlier: true,
    });
    getEarlierCoachConversations.mockResolvedValueOnce({
      conversations: [
        {
          sessionId: 'sess-0',
          startedAt: '2026-08-12T09:00:00Z',
          lastActiveAt: '2026-08-12T09:30:00Z',
          turns: [{ role: 'coach', content: 'the tail of a very long talk' }],
          truncated: true,
        },
      ],
      hasMore: false,
      nextBefore: '2026-08-12T09:00:00Z',
    });
    coachTab();
    fireEvent.click(await screen.findByRole('button', { name: /earlier conversations/i }));
    expect(await screen.findByText(/only the last stretch/i)).toBeInTheDocument();
  });

  /** "stale" is a wire word; the screen never says it, and neither does anything new here. */
  it('never puts a wire word on screen', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      stale: true,
      staleReason: 'idle',
      messages: [{ role: 'coach', content: 'earlier chatter' }],
      startedAt: '2026-08-19T10:00:00Z',
      hasEarlier: true,
    });
    const { container } = coachTab();
    await screen.findByText('earlier chatter');
    expect(container.textContent).not.toMatch(/stale/i);
  });
});
