import { Router, type Request, type Response } from 'express';
import { isJournalBankId, isJournalMode, journalBank } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { createEntry, deleteEntry, listEntries, setEntrySecret } from '../repos/journal-entries.ts';

const router = Router();
router.use(requireCadenceUser);

/** Verbatim, but bounded — a cap is the only transformation the journal ever applies to words. */
const MAX_BODY = 10_000;
const MAX_PROMPT = 300;

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
