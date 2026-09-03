/**
 * Collections — list, make, rename, remove (P11, migration 0056).
 *
 * Its own router mounted at '/progress', the same pattern repertoire-seed.ts and progress-extras.ts
 * already use: a collection is a distinct responsibility with its own table and its own screen, and
 * progress-extras.ts is near the size cap.
 *
 * Deterministic throughout — no coach call, no AI. A duplicate name answers 409 with the sentence
 * naming the spelling already on file, exactly as an item rename collision does; a wrong id answers
 * 404, because an id from a request is not proof of ownership.
 *
 * REMOVING A COLLECTION NEVER REMOVES AN ITEM. The foreign key is `on delete set null`, so its
 * items keep their rows, their history and their standings and simply stop being grouped.
 */
import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { BodyValidationError, parseBody, repertoireCollectionBodySchema } from '../validation/body.ts';
import {
  createCollection,
  deleteCollection,
  listCollections,
  renameCollection,
  RepertoireCollectionConflictError,
} from '../repos/repertoire-collections.ts';

const router = Router();
router.use(requireCadenceUser);

/** GET /progress/repertoire/collections — `{ collections: [{collection_id, name, item_count}] }`,
 *  most-used first. The item screen's picker and the collections screen read the same list, so the
 *  order a person sees in one is the order they see in the other. */
router.get('/repertoire/collections', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ collections: await listCollections(userId) });
  } catch (err) {
    console.error('[GET /progress/repertoire/collections]', err);
    res.status(500).json({ error: 'failed to load collections' });
  }
});

/** POST /progress/repertoire/collections `{ name }` — the new row, `{collection_id, name,
 *  item_count}` with a count of zero. A name they already have (ignoring case) is 409, not a
 *  silent fold: they asked to make one and would otherwise watch nothing happen. */
router.post('/repertoire/collections', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { name } = parseBody(repertoireCollectionBodySchema, req.body);
    res.json(await createCollection(userId, name));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    if (err instanceof RepertoireCollectionConflictError) return void res.status(409).json({ error: err.message });
    console.error('[POST /progress/repertoire/collections]', err);
    res.status(500).json({ error: 'failed to add the collection' });
  }
});

/** PATCH /progress/repertoire/collections/:id `{ name }` — the renamed row. The row is the
 *  identity, so every item pointed at it reads the new name at once; nothing else changes. */
router.patch('/repertoire/collections/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const id = req.params.id as string;
  try {
    const { name } = parseBody(repertoireCollectionBodySchema, req.body);
    const row = await renameCollection(userId, id, name);
    if (!row) return void res.status(404).json({ error: 'collection not found' });
    res.json(row);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    if (err instanceof RepertoireCollectionConflictError) return void res.status(409).json({ error: err.message });
    console.error('[PATCH /progress/repertoire/collections/:id]', err);
    res.status(500).json({ error: 'failed to rename the collection' });
  }
});

/** DELETE /progress/repertoire/collections/:id — `{ ok: true }`. The items stay on the list. */
router.delete('/repertoire/collections/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const id = req.params.id as string;
  try {
    const removed = await deleteCollection(userId, id);
    if (!removed) return void res.status(404).json({ error: 'collection not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /progress/repertoire/collections/:id]', err);
    res.status(500).json({ error: 'failed to remove the collection' });
  }
});

export default router;
