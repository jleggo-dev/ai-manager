/**
 * `propose_progress_layout` — thin over `composeProgressLayout`, so what's tested here is the
 * translation: each outcome becomes the right instruction to her, with no length mandate on the
 * fact itself (TR-1) — the honesty guard ("you have not seen the card") stays.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./progress-layout-compose.ts', () => ({ composeProgressLayout: vi.fn() }));

import { composeProgressLayout } from './progress-layout-compose.ts';
import { PROPOSE_PROGRESS_LAYOUT } from './coach-action-progress-layout.ts';

beforeEach(() => {
  vi.mocked(composeProgressLayout).mockReset();
});

describe('propose_progress_layout', () => {
  it('refuses with nothing proposed when no description was given', async () => {
    const out = await PROPOSE_PROGRESS_LAYOUT.run('u1', {});
    expect(composeProgressLayout).not.toHaveBeenCalled();
    expect(out).toContain('nothing was proposed');
  });

  it('states the card is up as a plain fact, with no length mandate, and keeps the honesty guard', async () => {
    vi.mocked(composeProgressLayout).mockResolvedValue({
      ok: true,
      draft_id: 'd1',
      layout: {} as never,
    });
    const out = await PROPOSE_PROGRESS_LAYOUT.run('u1', { what_they_want: 'wants to see pages written' });
    expect(out).toContain('It is up for them to look at.');
    expect(out).toContain('Do not describe any of the sections');
    expect(out).not.toMatch(/Say ONE short line|and STOP/);
  });

  it('tells her plainly, never reading the reasons aloud, when composition fails its own checks', async () => {
    vi.mocked(composeProgressLayout).mockResolvedValue({ ok: false, reasons: ['too vague'] });
    const out = await PROPOSE_PROGRESS_LAYOUT.run('u1', { what_they_want: 'something' });
    expect(out).toContain('NOT proposed');
    expect(out).toContain('never read the list above aloud');
  });
});
