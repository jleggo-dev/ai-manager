import { sql } from '../db/sql.ts';
import type { Conversation } from '@cadence/shared';

/** Map a Cadence conversation to an AI Admin chat session (spec §C6). */
export async function createConversation(
  userId: string,
  aiSessionId: string,
  externalChatId: string | null,
): Promise<Conversation> {
  const [row] = await sql<Conversation[]>`
    insert into cadence.conversations (user_id, ai_session_id, external_chat_id)
    values (${userId}, ${aiSessionId}, ${externalChatId})
    returning *`;
  if (!row) throw new Error('createConversation: no row returned');
  return row;
}

/** The user's most recent conversation → used to restore the chat on refresh. */
export async function getLatestConversation(userId: string): Promise<Conversation | null> {
  const [row] = await sql<Conversation[]>`
    select * from cadence.conversations where user_id = ${userId}
    order by created_at desc limit 1`;
  return row ?? null;
}

export async function getConversationByAiSession(aiSessionId: string): Promise<Conversation | null> {
  const [row] = await sql<Conversation[]>`
    select * from cadence.conversations where ai_session_id = ${aiSessionId}`;
  return row ?? null;
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  return sql<Conversation[]>`select * from cadence.conversations where user_id = ${userId}`;
}

/** Bump updated_at on message activity — feeds the coach-session idle-staleness rule. */
export async function touchConversation(aiSessionId: string): Promise<void> {
  await sql`update cadence.conversations set updated_at = now() where ai_session_id = ${aiSessionId}`;
}

/** Update the rolling summary + token estimate (drives the budget tiers, §4.3). */
export async function updateConversationContext(
  conversationId: string,
  fields: { rolling_summary?: string; token_estimate?: number },
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (fields.rolling_summary !== undefined) updates.rolling_summary = fields.rolling_summary;
  if (fields.token_estimate !== undefined) updates.token_estimate = fields.token_estimate;
  if (Object.keys(updates).length === 0) return;
  await sql`
    update cadence.conversations set ${sql(updates)}, updated_at = now()
    where conversation_id = ${conversationId}`;
}
