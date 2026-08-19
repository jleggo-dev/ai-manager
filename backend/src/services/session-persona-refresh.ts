/**
 * Keeping a live chat session's system prompt in step with the job that owns it.
 *
 * A job-bound session snapshots `config.systemPrompt` at open — into `chat_sessions.system_prompt`
 * and, more importantly, into a `role:'system'` message row, which is what actually reaches the
 * provider. Nothing revisited it, so **an edit to the job's prompt reached only sessions opened
 * afterwards**. Measured on Cadence 2026-08-19, minutes after a persona push: the job carried
 * 20,647 characters with the new rule and the owner's own live session carried 19,832 without it;
 * of 205 active sessions, 6 had it. Sessions rotate only after seven idle days, so a daily user's
 * never does, and every prompt fix looked like it had done nothing to the person who reported the
 * bug.
 *
 * Refreshing IN PLACE rather than forcing a new session is the gentler of the two fixes: nobody's
 * conversation ends because someone deployed a wording change.
 *
 * **What makes it safe is `config.prompt`, written at open.** The stored prompt can be a
 * concatenation — `[job, caller]` — and without knowing which half came from where, a rebuild
 * would have to guess, and would eventually throw away a caller's per-session context. So the job
 * half is identified by hash and the caller half is kept verbatim; a rebuild replaces only the
 * first. Sessions opened before that record existed are left alone, deliberately: they carry no
 * way to tell the halves apart, and they age out on their own.
 */

import { createHash } from 'node:crypto';
import type { ChatSessionRow, ProcessingJobRow } from '../types.ts';
import { listChatMessages, updateChatMessage, updateChatSession } from '../models/chat-sessions.ts';
import { errorMessage } from '../lib/error-message.ts';

/** Short, stable fingerprint of a prompt. Only ever compared for equality. */
export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

interface PromptProvenance {
  jobHash: string;
  caller: string | null;
}

function readProvenance(session: ChatSessionRow): PromptProvenance | null {
  const p = (session.config as { prompt?: Partial<PromptProvenance> } | null | undefined)?.prompt;
  if (!p || typeof p.jobHash !== 'string') return null;
  return { jobHash: p.jobHash, caller: typeof p.caller === 'string' ? p.caller : null };
}

/** How `chat-session-open` composes the two halves. Kept identical on purpose. */
export function composeSystemPrompt(jobPrompt: string, caller: string | null): string {
  return [jobPrompt, caller].filter(Boolean).join('\n\n');
}

/**
 * Bring the session's system prompt up to date with its job, if it has fallen behind.
 *
 * Best-effort by contract: a failure here must never cost the user their turn, so everything is
 * caught and reported false. Returns whether anything was rewritten.
 */
export async function refreshSessionSystemPrompt(
  session: ChatSessionRow,
  job: ProcessingJobRow | null,
): Promise<boolean> {
  // A workflow's own prompt takes precedence at open, so its sessions are not ours to touch.
  if (!job || session.workflow_id) return false;

  const jobPrompt = (job.config as { systemPrompt?: string } | undefined)?.systemPrompt;
  if (!jobPrompt) return false;

  const provenance = readProvenance(session);
  if (!provenance) return false; // opened before this existed — cannot tell the halves apart

  const nextHash = hashPrompt(jobPrompt);
  if (provenance.jobHash === nextHash) return false;

  const effective = composeSystemPrompt(jobPrompt, provenance.caller);

  try {
    const messages = await listChatMessages(session.id);
    const systemRow = messages.find((m) => m.role === 'system');
    // The row is what reaches the provider (`buildSessionChatMessages` → `messagesToV2Request`),
    // so the column alone would be a convincing lie. If the row is missing there is nothing to
    // rewrite and the column would misreport what the model is being sent — leave both.
    if (!systemRow) return false;

    await updateChatMessage(systemRow.id, { content: effective });
    await updateChatSession(session.id, {
      system_prompt: effective,
      config: {
        ...((session.config as Record<string, unknown> | null) ?? {}),
        prompt: { jobHash: nextHash, caller: provenance.caller },
      },
    } as Partial<ChatSessionRow>);

    console.info('[session-persona] refreshed system prompt', {
      sessionId: session.id,
      jobSlug: job.slug,
      chars: effective.length,
    });
    return true;
  } catch (err) {
    console.warn('[session-persona] refresh failed:', errorMessage(err));
    return false;
  }
}
