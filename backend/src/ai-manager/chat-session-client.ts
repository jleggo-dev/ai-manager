/**
 * Chat session LLM client resolution + workflow step completion helpers.
 * Leaf helpers shared by chat-session-lifecycle and chat-messaging.
 */

import { getAiProfileWithKeys } from '../models/ai-profiles.ts';
import { listWorkflowSteps } from '../models/workflows.ts';
import { createLlmClientForProvider, createLlmClientForUser } from '../integrations/client-factory.ts';
import { listChatMessages } from '../models/chat-sessions.ts';
import type { ChatSessionRow, LlmClient, ProviderRow } from '../types.ts';

export async function getSessionProviderWithKey(session: ChatSessionRow): Promise<ProviderRow> {
  const profileId = session.ai_profile?.id || session.ai_profile_id;
  if (!profileId) throw new Error('Chat session has no AI profile');
  const fullProfile = await getAiProfileWithKeys(profileId);
  if (!fullProfile?.provider) throw new Error('AI profile has no provider with credentials');
  return fullProfile.provider;
}

/**
 * Choose the correct LLM client based on how the session was created.
 * Sessions opened with personal credentials continue using that user's key;
 * all others use the workspace-shared provider key.
 */
export async function resolveSessionClient(session: ChatSessionRow, provider: ProviderRow): Promise<LlmClient> {
  if (session.uses_user_credentials && session.user_id) {
    return createLlmClientForUser(provider, session.user_id);
  }
  return createLlmClientForProvider(provider);
}

/**
 * Determine which workflow step_keys have been completed in a chat session
 * by checking for user messages tagged with a workflow_step_id.
 */
export async function getCompletedWorkflowSteps(sessionId: string, workflowId: string): Promise<Set<string>> {
  const messages = await listChatMessages(sessionId);
  const completedStepIds = new Set<string>(
    messages.filter((m) => m.workflow_step_id).map((m) => m.workflow_step_id as string),
  );
  if (completedStepIds.size === 0) return new Set();

  const steps = await listWorkflowSteps(workflowId);
  return new Set(steps.filter((s) => completedStepIds.has(s.id)).map((s) => s.step_key));
}
