/**
 * The questionnaire card's two routes, from the client's side: read what is up, and clear it.
 *
 * These two are the whole reason the chat can show a card at all — a tool call never reaches the
 * browser, so the questions travel as a pointer the client polls (the rail
 * /progress/repertoire/seed/offer already runs on). What is worth pinning here is the failure
 * shape: a read that BROKE must answer "nothing up" rather than 500ing a whole conversation over a
 * card, and clearing must be honest about failing, because a clear that silently did nothing puts
 * the same questions back on the next turn after the person already answered them.
 *
 * And the negative that matters most: there is no route here that takes an answer. The answers are
 * an ordinary message on the ordinary send path, and a second door for them would be an invisible
 * record of words the person cannot see they said.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getPendingQuestionnaire = vi.fn();
const setPendingQuestionnaire = vi.fn(async (_id: string, _q: unknown) => undefined);

vi.mock('../repos/users.ts', () => ({
  getPendingQuestionnaire: (id: string) => getPendingQuestionnaire(id),
  setPendingQuestionnaire: (id: string, q: unknown) => setPendingQuestionnaire(id, q),
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: coachQuestionnaireRoutes } = await import('./coach-questionnaire.ts');

const PENDING = {
  questions: [
    { id: 'days_free', label: 'Which days are usually free?', kind: 'multi', options: ['Mon', 'Wed', 'Sat'] },
    { id: 'session_length', label: 'How long can a session be?', kind: 'number', hint: 'in minutes' },
  ],
  sent_at: '2026-09-03T18:00:00.000Z',
};

async function call(method: 'GET' | 'POST', path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = express();
  app.use(express.json());
  app.use('/coach', coachQuestionnaireRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getPendingQuestionnaire.mockResolvedValue(PENDING);
});

describe('GET /coach/questionnaire', () => {
  it('hands back the questions the coach put up', async () => {
    const res = await call('GET', '/coach/questionnaire');
    expect(res.status).toBe(200);
    expect(res.body.questionnaire).toEqual(PENDING);
    expect(getPendingQuestionnaire).toHaveBeenCalledWith('u1');
  });

  it('answers null when no card is standing', async () => {
    getPendingQuestionnaire.mockResolvedValue(null);
    const res = await call('GET', '/coach/questionnaire');
    expect(res.status).toBe(200);
    expect(res.body.questionnaire).toBeNull();
  });

  it('answers "nothing up" rather than an error when the read breaks', async () => {
    getPendingQuestionnaire.mockRejectedValue(new Error('down'));
    const res = await call('GET', '/coach/questionnaire');
    expect(res.status).toBe(200);
    expect(res.body.questionnaire).toBeNull();
  });
});

describe('POST /coach/questionnaire/clear', () => {
  it('clears the card and says so', async () => {
    const res = await call('POST', '/coach/questionnaire/clear');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setPendingQuestionnaire).toHaveBeenCalledWith('u1', null);
  });

  it('reports a failed clear rather than swallowing it', async () => {
    setPendingQuestionnaire.mockRejectedValue(new Error('down'));
    const res = await call('POST', '/coach/questionnaire/clear');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});

describe('the door that does not exist', () => {
  it('has no route that accepts an answer — answers are an ordinary message', async () => {
    for (const path of ['/coach/questionnaire/answer', '/coach/questionnaire/submit', '/coach/questionnaire']) {
      const res = await call('POST', path);
      expect(res.status, `POST ${path} answered ${res.status}`).toBe(404);
    }
    expect(setPendingQuestionnaire).not.toHaveBeenCalled();
  });
});
