import { describe, expect, it, vi } from 'vitest';

/**
 * The privacy promise, made mechanical. `get_journal` is the ONLY path journal words take into a
 * context pack, and it must be impossible to widen — no parameter, no shape of input, nothing a
 * Scribe could select, may reach a secret entry.
 */
const listForCoach = vi.fn();
vi.mock('../../repos/journal-entries.ts', () => ({ listForCoach: (...a: unknown[]) => listForCoach(...a) }));

const { RETRIEVAL_FUNCTIONS } = await import('./registry.ts');
const fn = RETRIEVAL_FUNCTIONS.get_journal!;

describe('get_journal — the coach-safe reader', () => {
  it('reads through listForCoach, never the owner-facing list', async () => {
    listForCoach.mockResolvedValue([]);
    await fn.run('u1', {});
    expect(listForCoach).toHaveBeenCalledWith('u1', 8);
  });

  it('cannot be widened by a parameter — limit is clamped, and nothing selects secrets', async () => {
    listForCoach.mockResolvedValue([]);
    await fn.run('u1', { limit: 9999 });
    expect(listForCoach).toHaveBeenLastCalledWith('u1', 20);
    await fn.run('u1', { limit: -5 });
    expect(listForCoach).toHaveBeenLastCalledWith('u1', 1);
    // There is no `secret`/`includeSecret` parameter to pass — the reader itself excludes them.
    await fn.run('u1', { secret: true, includeSecret: true } as Record<string, unknown>);
    expect(listForCoach).toHaveBeenLastCalledWith('u1', 8);
  });

  it('renders words verbatim — never themes, sentiment, or a count', () => {
    const out = fn.render([
      { created_at: '2026-08-02T20:00:00Z', prompt: 'What were three good things?', body: 'Maya stayed on the phone.' },
    ]);
    expect(out).toContain('Maya stayed on the phone.');
    expect(out).toContain('asked: What were three good things?');
    expect(out).not.toMatch(/sentiment|theme|positive|negative|score|streak/i);
  });

  it('renders nothing at all when there are no entries', () => {
    expect(fn.render([])).toBe('');
  });
});
