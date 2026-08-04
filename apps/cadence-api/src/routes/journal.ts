import { Router, type Request, type Response } from 'express';
import { isJournalBankId, isJournalMode, journalBank, journalExportFilename, journalToMarkdown } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { createEntry, deleteEntry, listEntries, setEntrySecret } from '../repos/journal-entries.ts';

const router = Router();
router.use(requireCadenceUser);

/** Verbatim, but bounded — a cap is the only transformation the journal ever applies to words. */
const MAX_BODY = 10_000;
const MAX_PROMPT = 300;
/** Twenty years of writing something every day, and still a bounded query. */
const EXPORT_MAX = 100_000;

/**
 * GET /journal — the owner's bookshelf: everything, newest first, secrets included (the key locks
 * against the coach, not against you). Rule 1 applies to consumers: entries are for rereading,
 * never for analysis surfaces.
 */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ entries: await listEntries(userId) });
  } catch (err) {
    console.error('[GET /journal]', err);
    res.status(500).json({ error: 'failed to load journal' });
  }
});

/**
 * GET /journal/export — every word back, as Markdown (owner ruling 2026-08-04).
 *
 * Secrets included: the key locks entries against the coach, never against the person who wrote
 * them, and an export that withheld someone's own words would be a different promise than "never
 * makes you start over". Sent as an attachment so a phone treats it as a file to keep.
 *
 * Keep this route ABOVE any future `GET /:id` — express matches in order, and a parameterised
 * route declared first would swallow "/export" as an id.
 */
router.get('/export', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    // `listEntries` defaults to 100. An export that silently stopped there would be the worst bug
    // this endpoint could have — it looks complete and isn't — so ask for far more than anyone
    // will write, rather than accepting the shelf's page size.
    const entries = await listEntries(userId, EXPORT_MAX);
    const now = new Date().toISOString();
    res.type('text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${journalExportFilename(now)}"`);
    res.send(journalToMarkdown(entries, { exportedAt: now }));
  } catch (err) {
    console.error('[GET /journal/export]', err);
    res.status(500).json({ error: 'failed to export the journal' });
  }
});

/**
 * POST /journal — keep an entry. `paper` needs no body (a shelf row, secret by nature — the mode
 * itself implies it, so the flag is forced on server-side rather than trusted from the client);
 * every other mode needs words.
 */
router.post('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const mode = isJournalMode(typeof b.mode === 'string' ? b.mode : 'typed') ? (b.mode as string) : 'typed';
  const body = typeof b.body === 'string' ? b.body.slice(0, MAX_BODY) : '';
  if (mode !== 'paper' && !body.trim()) return res.status(400).json({ error: 'nothing to keep' });

  const bank = typeof b.bank === 'string' && isJournalBankId(b.bank) ? b.bank : null;
  // The kept prompt: trusted only when it is one of the bank's own reviewed phrasings — a client
  // can't smuggle arbitrary text into the "question" slot of the store.
  const promptRaw = typeof b.prompt === 'string' ? b.prompt.slice(0, MAX_PROMPT) : null;
  const prompt = bank && promptRaw && journalBank(bank)?.phrasings.includes(promptRaw) ? promptRaw : null;

  try {
    const entry = await createEntry(userId, {
      bank,
      prompt,
      body: mode === 'paper' ? '' : body,
      secret: mode === 'paper' ? true : b.secret === true,
      mode,
      sourceOccurrenceId: typeof b.source_occurrence_id === 'string' ? b.source_occurrence_id : null,
    });
    res.status(201).json({ entry });
  } catch (err) {
    console.error('[POST /journal]', err);
    res.status(500).json({ error: 'failed to keep the entry' });
  }
});

/** PATCH /journal/:id/secret — the key. Retroactive by design (REQ9 §8). */
router.patch('/:id/secret', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const secret = (req.body as { secret?: unknown } | undefined)?.secret === true;
  try {
    const ok = await setEntrySecret(userId, req.params.id as string, secret);
    if (!ok) return res.status(404).json({ error: 'no such entry' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /journal/:id/secret]', err);
    res.status(500).json({ error: 'failed to update' });
  }
});

/** DELETE /journal/:id — the owner's right. */
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const ok = await deleteEntry(userId, req.params.id as string);
    if (!ok) return res.status(404).json({ error: 'no such entry' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /journal/:id]', err);
    res.status(500).json({ error: 'failed to delete' });
  }
});

export default router;
