/**
 * @ai-admin/types — Zod schemas and inferred types from AI Admin backend.
 * Re-exports the backend schema modules for consumer type safety.
 */

export {
  createChatSessionSchema,
  resumeChatSessionSchema,
  sendMessageSchema,
  toolOutputsSchema,
} from '../../../backend/src/schemas/chat-sessions.ts';

export {
  createProcessingJobSchema,
  updateProcessingJobSchema,
  executeJobSchema,
} from '../../../backend/src/schemas/processing-jobs.ts';

export {
  createWorkflowSchema,
  updateWorkflowSchema,
} from '../../../backend/src/schemas/workflows.ts';

export {
  createAiProfileSchema,
  updateAiProfileSchema,
} from '../../../backend/src/schemas/ai-profiles.ts';

export { runSlotSchema } from '../../../backend/src/schemas/ai-matcher.ts';
