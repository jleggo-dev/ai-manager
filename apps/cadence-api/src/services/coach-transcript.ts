/**
 * Reading a conversation back — what counts as a turn the user actually had, and how an archived
 * thread is fetched for display.
 *
 * The transcripts are NOT a second copy of anything: AI Admin keeps every `chat_messages` row for
 * the life of the session, and compaction (`buildCompactedHistory`) only ever rewrites what is
 * handed to the MODEL at request time. Nothing deletes a turn except an explicit session reset. So
 * the full record is always there to be read — it simply had no route to reach the screen through,
 * which is the whole reason this file exists.
 *
 * Lives in services rather than in `routes/coach.ts` because the route is a caller, not a home: a
 * service that had to import from a route to learn what a real turn is would have the dependency
 * pointing the wrong way.
 */
import { getCoachHistory } from '../ai/aim.ts';
import { listConversationsBefore } from '../repos/conversations.ts';
import { isRealTurn, type DisplayTurn } from './coach-turns.ts';
import type { Conversation } from '@cadence/shared';

/**
 * How many turns of ONE archived conversation are shipped for display.
 *
 * A bound rather than a page, because the two ends are not equally interesting: someone reading
 * back wants how a conversation ENDED and what it settled on, so a thread past the cap keeps its
 * tail. Real threads sit well under this (the longest on file is 82); the cap exists so a single
 * pathological session cannot put megabytes on a phone in one request.
 */
export const ARCHIVE_TURN_CAP = 300;

/** The user/coach turns of one AI Admin session, app-authored turns stripped. */
export async function readTranscript(userId: string, aiSessionId: string): Promise<DisplayTurn[]> {
  const hist = (await getCoachHistory(userId, aiSessionId)) as { messages?: unknown; data?: unknown };
  const raw = (hist.messages ?? hist.data ?? []) as Array<{ role?: string; content?: string }>;
  return raw
    .filter(isRealTurn)
    .map((m) => ({ role: m.role === 'assistant' ? ('coach' as const) : ('user' as const), content: m.content ?? '' }));
}

export interface ArchivedConversation {
  sessionId: string;
  startedAt: string;
  lastActiveAt: string;
  turns: DisplayTurn[];
  /** Older turns were dropped to stay inside ARCHIVE_TURN_CAP — the screen says so plainly. */
  truncated: boolean;
}

/**
 * How many conversation rows one request will look at before giving up.
 *
 * Reading back is one conversation per tap, but a row is not the same thing as a conversation
 * worth showing: opening the Coach tab creates a session, and one that is never spoken into leaves
 * a row whose only turns are injected context. Those are skipped rather than rendered as an empty
 * "earlier conversation", so a request may have to look past a few rows to find a real one — and
 * this is the point at which it stops looking rather than walking someone's entire archive.
 */
const SCAN_CAP = 8;

/**
 * The next `want` conversations behind `before`, with their transcripts, newest first.
 *
 * `hasMore` is deliberately about ROWS not about content: it says there is more archive behind the
 * last one looked at, which is the only question the "read earlier" control needs answered. When a
 * scan runs out of rows entirely it reports false and the control retires itself.
 *
 * `nextBefore` is where the NEXT request should start, and it is the cursor precisely because it
 * tracks rows rather than results. A client that advanced its cursor by the last conversation it
 * received would stall forever on a stretch of empty rows — it would re-scan the same ones, filter
 * them all out again, and ask again from the same place. This moves past everything examined,
 * whether or not it turned out to be worth showing.
 */
export async function readArchivedConversations(
  userId: string,
  before: string,
  want: number,
): Promise<{ conversations: ArchivedConversation[]; hasMore: boolean; nextBefore: string | null }> {
  const rows = await listConversationsBefore(userId, before, SCAN_CAP);
  const out: ArchivedConversation[] = [];
  let scanned = 0;
  for (const row of rows) {
    if (out.length >= want) break;
    scanned++;
    const conv = await archiveOne(userId, row);
    if (conv) out.push(conv);
  }
  return {
    conversations: out,
    // More archive behind us if the scan stopped early (we filled the request) or the page was full.
    hasMore: scanned < rows.length || rows.length === SCAN_CAP,
    nextBefore: rows[scanned - 1]?.created_at ?? null,
  };
}

/** One row → one displayable conversation, or null when it holds nothing the user ever said. */
async function archiveOne(userId: string, row: Conversation): Promise<ArchivedConversation | null> {
  let turns: DisplayTurn[];
  try {
    turns = await readTranscript(userId, row.ai_session_id);
  } catch (e) {
    // One unreadable thread must not cost the reader the rest of their history: skip it and
    // carry on, the same way a missing page is better than a broken book.
    console.error('[readArchivedConversations]', row.ai_session_id, e);
    return null;
  }
  if (!turns.length) return null;
  const truncated = turns.length > ARCHIVE_TURN_CAP;
  return {
    sessionId: row.ai_session_id,
    startedAt: row.created_at,
    lastActiveAt: row.updated_at ?? row.created_at,
    turns: truncated ? turns.slice(-ARCHIVE_TURN_CAP) : turns,
    truncated,
  };
}
