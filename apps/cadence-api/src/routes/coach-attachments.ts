/**
 * POST /coach/attachments — mint the one-shot upload for a file the composer is about to send
 * (owner, 2026-09-11). A fourth router on '/coach', the pattern the others use.
 *
 * This is the trust boundary for what a file IS and how big it may be: the composer has already
 * checked both (shrinking a photo first), but the composer is not the server. The same shared
 * functions decide here, so the two cannot disagree — and the bucket itself enforces the byte cap
 * on the upload the browser makes next, which this route never sees.
 */
import { Router, type Request, type Response } from 'express';
import { attachmentRejectionText, checkAttachmentSize, classifyAttachment } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { COACH_ATTACHMENTS_BUCKET, signCoachUpload } from '../services/coach-attachments.ts';
import { BodyValidationError, coachAttachmentSignBodySchema, parseBody } from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);

router.post('/attachments', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(coachAttachmentSignBodySchema, req.body);
    const classified = classifyAttachment(body.name, body.mime);
    if (!classified) {
      return void res.status(400).json({ error: attachmentRejectionText(body.name, { reason: 'unsupported_type' }) });
    }
    const tooBig = checkAttachmentSize(classified.kind, body.size);
    if (tooBig) return void res.status(400).json({ error: attachmentRejectionText(body.name, tooBig) });

    const { ref, token } = await signCoachUpload(userId, classified.mime);
    res.json({ ref, token, bucket: COACH_ATTACHMENTS_BUCKET, kind: classified.kind, mime: classified.mime });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /coach/attachments]', err);
    res.status(500).json({ error: 'could not prepare the upload' });
  }
});

export default router;
