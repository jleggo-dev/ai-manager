/**
 * @ai-admin/core — in-process surface for the AI Admin engine.
 *
 * Cadence's Node backend imports the engine + tenant helpers from HERE rather
 * than reaching into `backend/src/*`. This keeps the in-process coupling (spec
 * §8.1) explicit and gives us a single seam to stabilize as AI Admin evolves.
 *
 * Export groups:
 *   - Hot path — request-time chat/job execution + tenant auth (apps/cadence-api
 *     runtime, especially `src/ai/aim.ts`).
 *   - Provisioning (cold path) — AI-profile / processing-job CRUD for one-off
 *     scripts under `apps/cadence-api/scripts/` only. Do not import these from
 *     request handlers.
 *
 * Runtime requirements (the host process must satisfy these):
 *   1. AI Admin's standard env must be present — `AI_MANAGER_SUPABASE_URL`,
 *      `AI_MANAGER_SUPABASE_ANON_KEY`, `AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY`,
 *      `CREDENTIAL_ENCRYPTION_KEY`, `DEVS_AI_*`. See `backend/.env.example`.
 *   2. This is a NODE surface, not Deno. A Supabase Edge Function cannot import
 *      it. In-process consumption implies a Node host (apps/cadence-api).
 *   3. Every engine call must run inside `runWithAuth(ctx, fn)` so that
 *      `getAuthContext()` / `tenantFrom()` resolve. See apps/cadence-api/src/ai/aim.ts.
 *
 * Intentionally NOT exported: `getServiceSupabase` (service-role client that
 * bypasses RLS). Backend code may import it from `backend/src/db/service-supabase.ts`;
 * Cadence must never hold that handle — use `runWithAuth` + tenant helpers instead.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * HOT PATH — request-time surface (Cadence API runtime / aim.ts)
 * ═══════════════════════════════════════════════════════════════════════════ */

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

/**
 * Model-layer chat message writer (one level below the Coach engine).
 * Used by Cadence to inject a context block as a non-triggering turn without
 * going through `sendChatMessage`. Prefer engine APIs when a full turn is needed.
 */
export { createChatMessage } from '../../../backend/src/models/chat-sessions.ts';

/* ── Processing jobs (runtime lookup by slug for job execution) ── */
export { getProcessingJobBySlug } from '../../../backend/src/models/processing-jobs.ts';

/* ── Tenant / auth context — establish before any engine call ── */
export {
  runWithAuth,
  getAuthContext,
  effectiveUserId,
  tenantFrom,
  tenantClient,
} from '../../../backend/src/db/tenant.ts';

export type { RequestAuthContext } from '../../../backend/src/types.ts';

/* ═══════════════════════════════════════════════════════════════════════════
 * PROVISIONING (cold path) — scripts only (`apps/cadence-api/scripts/*`)
 * Do not import from request handlers / aim.ts.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── AI profiles (Coach persona / config managed in AI Admin) ── */
export { getAiProfile, getAiProfileBySlug, updateAiProfile } from '../../../backend/src/models/ai-profiles.ts';

/* ── Processing jobs (create/update + id lookup for provisioning) ── */
export {
  createProcessingJob,
  updateProcessingJob,
  getProcessingJob,
} from '../../../backend/src/models/processing-jobs.ts';
