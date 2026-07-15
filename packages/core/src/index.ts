/**
 * @ai-admin/core — in-process surface for the AI Admin engine.
 *
 * Cadence's Node backend imports the engine + tenant helpers from HERE rather
 * than reaching into `backend/src/*`. This keeps the in-process coupling (spec
 * §8.1) explicit and gives us a single seam to stabilize as AI Admin evolves.
 *
 * Runtime requirements (the host process must satisfy these):
 *   1. AI Admin's standard env must be present — `AI_MANAGER_SUPABASE_URL`,
 *      `AI_MANAGER_SUPABASE_ANON_KEY`, `AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY`,
 *      `CREDENTIAL_ENCRYPTION_KEY`, `DEVS_AI_*`. See `backend/.env.example`.
 *   2. This is a NODE surface, not Deno. A Supabase Edge Function cannot import
 *      it. In-process consumption implies a Node host (apps/cadence-api).
 *   3. Every engine call must run inside `runWithAuth(ctx, fn)` so that
 *      `getAuthContext()` / `tenantFrom()` resolve. See apps/cadence-api/src/ai/aim.ts.
 */

/* ── Engine: Broker (templated jobs) ─────────────────────────── */
export {
  executeJob,
  executeJobById,
  executeRawPrompt,
  uploadApiDataSourcesChunked,
} from '../../../backend/src/ai-manager/index.ts';

/* ── Engine: Coach (streaming chat sessions) + lifecycle ─────── */
export {
  openChatSession,
  resumeChatSession,
  sendChatMessage,
  submitChatToolOutputs,
  recordAssistantMessage,
  extractAndAccumulateOutputs,
  fulfillPendingToolJobCalls,
  getToolJobsFromProfile,
  getChatHistory,
  getChatSessionFiles,
  closeChatSession,
  resetChatSession,
  removeChatSession,
  purgeRemoteChatsForUser,
} from '../../../backend/src/ai-manager/index.ts';

/* ── AI profiles (read the Coach persona / config managed in AI Admin) ── */
export { getAiProfile, getAiProfileBySlug, updateAiProfile } from '../../../backend/src/models/ai-profiles.ts';

/* ── Processing jobs (the Coach chat job owns its system prompt in build rules) ── */
export {
  createProcessingJob,
  updateProcessingJob,
  getProcessingJob,
  getProcessingJobBySlug,
} from '../../../backend/src/models/processing-jobs.ts';

/* ── Chat messages (inject the context block as a non-triggering turn) ── */
export { createChatMessage } from '../../../backend/src/models/chat-sessions.ts';

/* ── Tenant / auth context — establish before any engine call ── */
export {
  runWithAuth,
  getAuthContext,
  effectiveUserId,
  tenantFrom,
  tenantClient,
} from '../../../backend/src/db/tenant.ts';

export { getServiceSupabase } from '../../../backend/src/db/service-supabase.ts';

export type { RequestAuthContext } from '../../../backend/src/types.ts';
