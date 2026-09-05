import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The "Cadence noticed" line is user-facing and speaks in her voice, so the app must not make a
 * coaching decision inside it. Two of the RPE branches did: "so today sits a notch easier" and
 * "push a little today and I'll move the plan up if it sticks" — a promise the app cannot keep
 * (nothing guarantees the prescribed session is easier) and a prescription she never made. Facts,
 * not picks (owner 2026-09-03): the line reads back what the user marked, and stops there.
 */

const lastFeedbackForActivity = vi.fn();
const listRecentLogsByTitle = vi.fn();

vi.mock('../repos/coach-moments.ts', () => ({
  lastFeedbackForActivity: (...a: unknown[]) => lastFeedbackForActivity(...a),
}));
vi.mock('../repos/occurrences.ts', () => ({
  listRecentLogsByTitle: (...a: unknown[]) => listRecentLogsByTitle(...a),
}));

const { getSessionInsight } = await import('./session-insight.ts');

const ACT = { activity_id: 'a1', title: 'Easy run' };

beforeEach(() => {
  vi.clearAllMocks();
  lastFeedbackForActivity.mockResolvedValue(null);
  listRecentLogsByTitle.mockResolvedValue([]);
});

describe('getSessionInsight — the RPE read-back', () => {
  it('reads back "too hard" without deciding what today is', async () => {
    lastFeedbackForActivity.mockResolvedValue({ rpe: 'too_hard' });

    const insight = await getSessionInsight('u1', ACT);

    expect(insight).toEqual({ source: 'last_feedback', text: 'Last time you marked this one too hard.' });
    expect(insight!.text).not.toMatch(/notch easier/);
    expect(insight!.text).not.toMatch(/still bites/);
  });

  it('reads back "too easy" without prescribing a push or promising a plan change', async () => {
    lastFeedbackForActivity.mockResolvedValue({ rpe: 'too_easy' });

    const insight = await getSessionInsight('u1', ACT);

    expect(insight).toEqual({ source: 'last_feedback', text: 'Last time you marked this one too easy.' });
    expect(insight!.text).not.toMatch(/push a little/);
    expect(insight!.text).not.toMatch(/move the plan up/);
  });

  it('says nothing about effort when the last answer was "just right"', async () => {
    lastFeedbackForActivity.mockResolvedValue({ rpe: 'just_right' });

    expect(await getSessionInsight('u1', ACT)).toBeNull();
  });

  it('leaves the other read-backs alone — only the two RPE branches changed', async () => {
    lastFeedbackForActivity.mockResolvedValue({ felt_state: 'more_wound_up' });

    const insight = await getSessionInsight('u1', ACT);

    expect(insight?.text).toMatch(/Last time this left you more wound up/);
  });
});
