import { describe, expect, it, vi } from 'vitest';

/**
 * The privacy promise, made mechanical. `get_journal` is the ONLY path journal words take into a
 * context pack, and it must be impossible to widen — no parameter, no shape of input, nothing a
 * Broker could select, may reach a secret entry.
 */
const listForCoach = vi.fn();
vi.mock('../../repos/journal-entries.ts', () => ({ listForCoach: (...a: unknown[]) => listForCoach(...a) }));

/**
 * Importing `registry.ts` drags in every repo it reads from, and each of those imports `db/sql.ts`
 * → `config.ts`, which builds the Postgres URL AT MODULE SCOPE and throws when no CADENCE_* creds
 * exist. That's invisible locally (a developer's .env always has them) and fatal in CI, which runs
 * the cadence job deliberately without DB secrets — every other DB-touching suite here stays green
 * by never letting config.ts load (see plan-commit.test.ts's guard + lazy imports).
 *
 * These two mocks are that wall: `db/sql.ts` severs every repo at once, and `usda-enrich.ts` severs
 * the food-source subtree, which reaches config.ts by its own path. Don't remove them to "simplify"
 * — the test passes either way on a dev machine and only fails once it's pushed.
 */
vi.mock('../../db/sql.ts', () => ({ sql: vi.fn(), json: vi.fn() }));
vi.mock('../food-sources/usda-enrich.ts', () => ({ searchFoodsWithUsda: vi.fn() }));

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
