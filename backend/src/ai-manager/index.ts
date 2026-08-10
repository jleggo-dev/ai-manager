/**
 * AI Manager — Public Interface
 * ================================
 * This is the ONLY module that calling applications should import
 * from the AI Manager. All internal concerns (provider resolution,
 * prompt interpolation, LLM calls, formatting) are encapsulated here.
 *
 * Usage by a calling application:
 *
 *   import { executeJob } from '../ai-manager/index.ts';
 *
 *   const result = await executeJob('company-profiling', {
 *     callingApplication: 'company-prospector',
 *     variables: { companyName: 'HubSpot', domain: 'hubspot.com', ... },
 *   });
 *
 *   // result.formatted — the AI response after formatting rules
 *   // result.raw       — the raw AI response before formatting
 *   // result.metadata   — timing, model, usage, finish reason
 */

/* ── Job execution ───────────────────────────────────────────── */
export { executeJob, executeJobById, executeRawPrompt } from './job-execution.ts';

/* ── Chat session lifecycle ──────────────────────────────────── */
export {
  openChatSession,
  resumeChatSession,
  recordAssistantMessage,
  getChatSessionFiles,
  getChatHistory,
  closeChatSession,
  resetChatSession,
  removeChatSession,
  purgeRemoteChatsForUser,
} from './chat-session-lifecycle.ts';

/* ── Chat messaging ──────────────────────────────────────────── */
export {
  sendChatMessage,
  submitChatToolOutputs,
  submitV2ToolOutputs,
  updateV2ProviderMetadata,
  cancelV2ChatResponse,
  pauseV2ChatResponse,
  reconnectV2ChatStream,
} from './chat-messaging.ts';

/* ── Tool fulfillment ────────────────────────────────────────── */
export {
  extractAndAccumulateOutputs,
  fulfillPendingToolJobCalls,
  resolveProfileToolDefinitions,
  getToolJobsFromProfile,
  buildToolNameMap,
  type PendingToolCall,
  type ToolJobBinding,
} from './tool-fulfillment.ts';

/* ── Data-source upload ──────────────────────────────────────── */
export { uploadApiDataSourcesChunked } from './data-source-upload.ts';
