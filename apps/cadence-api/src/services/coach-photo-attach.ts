/**
 * MP13 — turn a chat message's attached photo into what the rest of the turn needs.
 *
 * Extracted from routes/coach.ts's message handler, which this pushed over the 150-line function
 * gate — a distinct responsibility (CLAUDE.md: "a distinct responsibility gets its own file"), not
 * a trim for its own sake.
 *
 * Two things come out of one upload, and both matter:
 *  (a) `images` — short-lived signed URLs spliced onto THIS turn as real vision content parts
 *      (sendCoachMessage → chat-messaging.ts → openChatSendStream), so she sees the photo directly,
 *      the same way job-based vision already can (request-builder.ts:105-111).
 *  (b) a durable, transcript-invisible `photo_ref` note via injectCoachContext — filtered by the
 *      same isRealTurn/APP_AUTHORED rule as every other `<context>` turn, so it never renders as
 *      something the user typed, but it DOES ride in history for a later turn, so she can still
 *      call read_label on it even if a structured read is not what this turn needs.
 *
 * Soft-fails on purpose: a photo that fails to upload must not sink a turn that also has real text
 * in it — but she is told it failed rather than left to guess why nothing came through.
 */
import { injectCoachContext } from '../ai/aim.ts';
import { putMealPhoto, signMealPhotoUrl } from './meal-photos.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

function photoNote(photoRef: string | null): string {
  if (photoRef) {
    return (
      `A photo is attached to this message (shown to you directly, above). photo_ref: "${photoRef}". ` +
      'For an exact, structured read — the printed numbers on a nutrition panel, or a product ' +
      'name and brand — call read_label with this exact photo_ref rather than transcribing it ' +
      'from what you see.'
    );
  }
  return (
    'A photo was attached to this message but failed to upload, so nothing came through. If it ' +
    'matters, tell the user to try attaching it again.'
  );
}

/**
 * Upload + sign `photo` and hand back the signed URL(s) to splice onto this turn. `photo` is
 * UNVALIDATED beyond "is it a string" — routes/coach.ts deliberately does not check its shape
 * before calling this, because by the time it can call this the response is already streaming SSE
 * and a 400 is no longer a clean option. `putMealPhoto`'s own `parsePhotoDataUrl` check is the real
 * gate; whatever it rejects (wrong prefix, bad base64, oversized) lands in the catch below and
 * comes out the same soft-fail door as a genuine upload error. Returns `[]` for no photo and `[]`
 * on any failure (logged; the note above tells her, so the turn continues on text alone rather
 * than dying over one bad image).
 */
export async function attachPhotoToTurn(userId: string, sessionId: string, photo: string | null): Promise<string[]> {
  if (!photo) return [];

  let photoRef: string | null = null;
  let images: string[] = [];
  try {
    photoRef = await putMealPhoto(userId, today(), photo);
    images = [await signMealPhotoUrl(photoRef)];
  } catch (e) {
    console.error('[coach photo attach]', e);
  }

  await injectCoachContext(userId, sessionId, photoNote(photoRef), {
    source: photoRef ? 'photo-attachment' : 'photo-attachment-failed',
    version: 1,
  }).catch((e) => console.error('[injectCoachContext photo]', e));

  return images;
}
