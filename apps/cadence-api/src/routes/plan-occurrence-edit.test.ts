/**
 * The hold-menu routes: the service's four answers map to four status codes, a bad body is a
 * 400 before the service is ever asked, and the conflict body carries the row the client needs
 * to open instead. Everything is mocked, so this never reaches db/sql.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const moveOccurrence = vi.fn();
const duplicateOccurrence = vi.fn();
const removeOccurrence = vi.fn();

vi.mock('../services/occurrence-edit.ts', () => ({
  moveOccurrence: (...a: unknown[]) => moveOccurrence(...a),
  duplicateOccurrence: (...a: unknown[]) => duplicateOccurrence(...a),
  removeOccurrence: (...a: unknown[]) => removeOccurrence(...a),
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: routes } = await import('./plan-occurrence-edit.ts');

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const a = express();
  a.use(express.json());
  a.use('/plan', routes);
  const server = a.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe('POST /plan/occurrences/:id/move', () => {
  it('200 with the row id, passing the zone hint through', async () => {
    moveOccurrence.mockResolvedValue({ status: 'ok', occurrence_id: 'occ-1' });
    const r = await post(
      '/plan/occurrences/occ-1/move',
      { date: '2026-09-10' },
      { 'X-Cadence-Timezone': 'America/Toronto' },
    );
    expect(r).toEqual({ status: 200, body: { ok: true, occurrence_id: 'occ-1' } });
    expect(moveOccurrence).toHaveBeenCalledWith('u1', 'occ-1', '2026-09-10', 'America/Toronto');
  });

  it.each([
    [{ status: 'not_found' }, 404],
    [{ status: 'out_of_range', from: '2026-09-07', to: '2026-09-13' }, 422],
    [{ status: 'conflict', existing_occurrence_id: 'occ-t', existing_status: 'done' }, 409],
  ])('%o → %i', async (result, code) => {
    moveOccurrence.mockResolvedValue(result);
    const r = await post('/plan/occurrences/occ-1/move', { date: '2026-09-10' });
    expect(r.status).toBe(code);
  });

  it('the conflict body names the row to open instead', async () => {
    moveOccurrence.mockResolvedValue({
      status: 'conflict',
      existing_occurrence_id: 'occ-t',
      existing_status: 'pending',
    });
    const r = await post('/plan/occurrences/occ-1/move', { date: '2026-09-07' });
    expect(r.body).toEqual({ error: 'already_there', existing_occurrence_id: 'occ-t', existing_status: 'pending' });
  });

  it('400 on a malformed date, before the service is asked', async () => {
    const r = await post('/plan/occurrences/occ-1/move', { date: 'tomorrow' });
    expect(r.status).toBe(400);
    expect(moveOccurrence).not.toHaveBeenCalled();
  });
});

describe('POST /plan/occurrences/:id/duplicate', () => {
  it("200 with the copy's id", async () => {
    duplicateOccurrence.mockResolvedValue({ status: 'ok', occurrence_id: 'occ-copy' });
    const r = await post('/plan/occurrences/occ-1/duplicate', { date: '2026-09-12' });
    expect(r).toEqual({ status: 200, body: { ok: true, occurrence_id: 'occ-copy' } });
  });

  it('409 when the day already has it', async () => {
    duplicateOccurrence.mockResolvedValue({
      status: 'conflict',
      existing_occurrence_id: 'occ-t',
      existing_status: 'pending',
    });
    const r = await post('/plan/occurrences/occ-1/duplicate', { date: '2026-09-12' });
    expect(r.status).toBe(409);
  });
});

describe('DELETE /plan/occurrences/:id', () => {
  it('200 ok, 404 when nothing was there', async () => {
    removeOccurrence.mockResolvedValue('ok');
    expect(await call('/plan/occurrences/occ-1', { method: 'DELETE' })).toEqual({ status: 200, body: { ok: true } });
    removeOccurrence.mockResolvedValue('not_found');
    expect((await call('/plan/occurrences/occ-x', { method: 'DELETE' })).status).toBe(404);
  });
});
