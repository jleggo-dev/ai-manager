import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { OnboardingChat } from './OnboardingChat.tsx';

// OnboardingChat mounts LayoutProposalCard, whose draft poll is a real useQuery (W3-2) — every
// render needs a QueryClientProvider now, same wrapper OnboardingChat.test.tsx uses.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
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
  getCoachFace: vi.fn().mockResolvedValue({ ok: true, faceId: null }),
  setCoachFace: vi.fn().mockResolvedValue(null),
  getHealthDigest: vi.fn().mockResolvedValue({ digest: null, created_at: null }),
  postHealthDigest: vi.fn().mockResolvedValue(true),
  postWorkoutHistory: vi.fn().mockResolvedValue(true),
  getPendingChange: vi.fn().mockResolvedValue(null),
  getProgressLayoutDraft: vi.fn().mockResolvedValue(null),
  // ChangeCard also reads the per-item detail now (to pick Show me vs inline Apply) — same
  // pre-existing-gap reasoning as getPendingWeekReview just below.
  getPendingChangeDetail: vi.fn().mockResolvedValue({ plan_version: null, items: [] }),
  dismissPendingChange: vi.fn().mockResolvedValue(true),
  lockPlan: vi.fn().mockResolvedValue({ ok: true }),
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
    expect(getEarlierCoachConversations).not.toHaveBeenCalled();
  });

  it('loads earlier conversations on its own, dated, above the one on screen', async () => {
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
          lastActiveAt: '2026-08-12T09:00:00Z',
          turns: [{ role: 'coach', content: 'we agreed on three runs a week' }],
          truncated: false,
        },
      ],
      hasMore: false,
      nextBefore: '2026-08-12T09:00:00Z',
    });

    coachTab();
    // No tap (owner, 2026-10-31): the top of a short transcript is in view, so history fills in.
    // (jsdom has no IntersectionObserver, so the marker asks straight away.)
    expect(await screen.findByText('we agreed on three runs a week')).toBeInTheDocument();
    expect(screen.getByText('how did the week go?')).toBeInTheDocument();
    expect(getEarlierCoachConversations).toHaveBeenCalledWith('2026-08-19T10:00:00Z', 1);
    // Two seams, both dated: where the archived conversation began, and where the one on screen
    // did. Asserted on the parts rather than the ordering — the label is locale-formatted, and the
    // runner's locale is not the user's.
    const [archived, current] = screen.getAllByRole('separator').slice(-2);
    expect(archived!.textContent).toMatch(/Wednesday/);
    expect(archived!.textContent).toMatch(/August/);
    expect(archived!.textContent).toMatch(/12/);
    expect(current!.textContent).toMatch(/Wednesday/);
    expect(current!.textContent).toMatch(/19/);
    expect(screen.queryByRole('button', { name: /earlier conversations/i })).not.toBeInTheDocument();
  });

  it('keeps loading until the archive runs out, oldest at the top', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      messages: [{ role: 'coach', content: 'how did the week go?' }],
      startedAt: '2026-08-19T10:00:00Z',
      hasEarlier: true,
    });
    getEarlierCoachConversations
      .mockResolvedValueOnce({
        conversations: [
          {
            sessionId: 's2',
            startedAt: '2026-08-12T09:00:00Z',
            lastActiveAt: '2026-08-12T09:00:00Z',
            turns: [{ role: 'coach', content: 'second' }],
            truncated: false,
          },
        ],
        hasMore: true,
        nextBefore: '2026-08-12T09:00:00Z',
      })
      // A stretch of empty rows: nothing to show, but the cursor moved, so it asks again.
      .mockResolvedValueOnce({ conversations: [], hasMore: true, nextBefore: '2026-08-08T09:00:00Z' })
      .mockResolvedValueOnce({
        conversations: [
          {
            sessionId: 's1',
            startedAt: '2026-08-05T09:00:00Z',
            lastActiveAt: '2026-08-05T09:00:00Z',
            turns: [{ role: 'coach', content: 'first' }],
            truncated: false,
          },
        ],
        hasMore: false,
        nextBefore: '2026-08-05T09:00:00Z',
      });

    coachTab();
    const first = await screen.findByText('first');
    const second = screen.getByText('second');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getEarlierCoachConversations).toHaveBeenCalledTimes(3);
  });

  it('offers a retry after a failed load instead of trying again on its own', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      messages: [{ role: 'coach', content: 'how did the week go?' }],
      startedAt: '2026-08-19T10:00:00Z',
      hasEarlier: true,
    });
    getEarlierCoachConversations
      .mockResolvedValueOnce({ conversations: [], hasMore: true, nextBefore: null })
      .mockResolvedValueOnce({
        conversations: [
          {
            sessionId: 's0',
            startedAt: '2026-08-12T09:00:00Z',
            lastActiveAt: '2026-08-12T09:00:00Z',
            turns: [{ role: 'coach', content: 'back again' }],
            truncated: false,
          },
        ],
        hasMore: false,
        nextBefore: '2026-08-12T09:00:00Z',
      });

    coachTab();
    const retry = await screen.findByRole('button', { name: /try loading earlier conversations again/i });
    expect(getEarlierCoachConversations).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    expect(await screen.findByText('back again')).toBeInTheDocument();
  });

  it('shows the conversation on screen without waiting for the archive', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      messages: [{ role: 'coach', content: 'how did the week go?' }],
      startedAt: '2026-08-19T10:00:00Z',
      hasEarlier: true,
    });
    // Never answers: the archive is slow, and the tab must not be.
    getEarlierCoachConversations.mockReturnValueOnce(new Promise(() => {}));
    coachTab();
    expect(await screen.findByText('how did the week go?')).toBeInTheDocument();
    expect(await screen.findByText('Looking back…')).toBeInTheDocument();
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
