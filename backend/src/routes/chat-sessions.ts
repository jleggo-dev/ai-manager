/**
 * Routes – Chat Sessions
 * -----------------------
 * REST + SSE endpoints for managing stateful AI chat conversations.
 * The POST /:id/messages endpoint returns an SSE stream.
 *
 * Split 2026-08-04 from a single 1190-line file into responsibility modules; THIS file is the
 * composition root and the stable import path. REGISTRATION ORDER IS LOAD-BEARING — express
 * matches routes in the order they were added, so the registrars run in the original file's
 * order: lifecycle (create/resume) → send-message → streams (tool-outputs/cancel/reconnect) →
 * admin reads. Do not reorder.
 */
import { Router } from 'express';
import { lifecycleRouter } from './chat-sessions/lifecycle.ts';
import { sendMessageRouter } from './chat-sessions/send-message.ts';
import { streamsRouter } from './chat-sessions/streams.ts';
import { adminRouter } from './chat-sessions/admin.ts';

const router = Router();
router.use(lifecycleRouter);
router.use(sendMessageRouter);
router.use(streamsRouter);
router.use(adminRouter);

export default router;
