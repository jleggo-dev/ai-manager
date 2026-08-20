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

/**
 * Record which upstream response is generating right now, so Stop can cancel THAT one.
 *
 * Best-effort on purpose: this is bookkeeping for a button, and a failed write must never take
 * down the turn the user is actually waiting on. Pass null when the turn ends.
 */
export async function setInFlightResponse(aiSessionId: string, responseId: string | null): Promise<void> {
  await sql`
    update cadence.conversations set in_flight_response_id = ${responseId}
    where ai_session_id = ${aiSessionId}`;
}

/**
 * "I'm leaving — tell me when she's done." Armed by the client the moment iOS backgrounds it
 * mid-turn (0035), because the server's own signal for an absent reader (a dead socket) is not
 * true yet at that point and may never be. Scoped to a live turn: armed only while one is in
 * flight, and cleared by the same path that clears `in_flight_response_id`, so it cannot survive
 * into the next turn as a stray ping.
 *
 * Best-effort like its neighbour: a failed write costs a notification, never the reply.
 */
export async function setNotifyOnReply(aiSessionId: string, on: boolean): Promise<void> {
  await sql`
    update cadence.conversations set notify_on_reply = ${on}
    where ai_session_id = ${aiSessionId}`;
}

/** Whether this thread is waiting to be told — read once, as the reply lands. */
export async function getNotifyOnReply(aiSessionId: string): Promise<boolean> {
  const [row] = await sql<{ notify_on_reply: boolean }[]>`
    select notify_on_reply from cadence.conversations where ai_session_id = ${aiSessionId}`;
  return row?.notify_on_reply === true;
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

/**
 * The conversations that came BEFORE this one, newest first — the server half of reading back
 * through the coach's history.
 *
 * Cursored on `created_at` rather than offset-paged because conversations are append-only: an
 * offset would shift under a page the moment a new thread opened mid-read, and the reader would
 * silently skip or repeat one.
 *
 * Returns the mapping rows only. The transcripts live in AI Admin (`chat_messages`) and are
 * fetched per conversation by `coach-transcript.ts` — one round trip per conversation the reader
 * actually asked for, never for the whole archive.
 */
export async function listConversationsBefore(userId: string, before: string, limit: number): Promise<Conversation[]> {
  return sql<Conversation[]>`
    select * from cadence.conversations
    where user_id = ${userId} and created_at < ${before}
    order by created_at desc limit ${limit}`;
}

/**
 * Is there anything at all behind this conversation — so the client offers to read back only when
 * there is somewhere to go.
 *
 * Counts ROWS, which includes conversations that turn out to hold no real turns (a session opened
 * and never spoken into). That makes this an upper bound, not a promise: a load that comes back
 * empty retracts the offer itself, which is cheaper than reading every archived transcript here
 * just to answer a yes/no on the chat's opening request.
 */
export async function countConversationsBefore(userId: string, before: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from cadence.conversations
    where user_id = ${userId} and created_at < ${before}`;
  return row?.n ?? 0;
}
