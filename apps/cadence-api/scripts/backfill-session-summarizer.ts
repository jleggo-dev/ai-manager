/**
 * Carry the live coach compaction policy (`COACH_SUMMARIZER`) onto coach sessions already open.
 *
 * The engine copies `config.summarizer` onto a session when it OPENS, and an active user's session
 * is restored, not reopened, so it never picks up a policy change. On 2026-10-31 every one of the
 * ~460 coach sessions that carried a summarizer still carried an old one (trigger 20,000 or 32,000,
 * a turn-counted tail, no guard). This writes the live policy onto every coach session that has
 * any summarizer, or was active in the last `--days` (default 30). Only `config.summarizer`
 * changes; the session's other config and its `updated_at` are left alone.
 *
 * Dry by default: prints what would change, by current trigger. `--write` applies it.
 *
 * Run: npm run backfill:session-summarizer -- [--days 30] [--write]
 */
import { getProcessingJobBySlug, listChatSessions, updateChatSessionConfig, type ChatSessionRow } from '@ai-admin/core';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';
import { COACH_SUMMARIZER } from '../src/services/coach-compaction-policy.ts';
import { planBackfill, withSummarizer } from './backfill-session-summarizer-plan.ts';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const daysAt = args.indexOf('--days');
const DAYS = daysAt >= 0 ? Number(args[daysAt + 1]) : 30;
if (!Number.isFinite(DAYS) || DAYS < 0) throw new Error(`--days needs a number of days, got ${args[daysAt + 1]}`);

const ACTOR = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';
const PAGE = 200;

/** Every Cadence chat session, newest first, a page at a time. */
async function allCadenceSessions(): Promise<ChatSessionRow[]> {
  const out: ChatSessionRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listChatSessions({
      callingApplication: cadenceConfig.aim.callingApplication,
      cursor,
      limit: PAGE,
    });
    out.push(...page.slice(0, PAGE));
    if (page.length <= PAGE) return out;
    cursor = page[PAGE - 1]?.created_at;
  }
}

async function main() {
  const policy = { ...COACH_SUMMARIZER } as Record<string, unknown>;
  await withAim(ACTOR, async () => {
    const job = await getProcessingJobBySlug(cadenceConfig.aim.coachJobSlug);
    if (!job) throw new Error(`coach job "${cadenceConfig.aim.coachJobSlug}" not found`);
    const sessions = await allCadenceSessions();
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
    const plan = planBackfill(sessions, { coachJobId: job.id, since, policy });

    console.log(`Cadence chat sessions read: ${sessions.length}`);
    console.log(`Coach sessions with a summarizer, or active in the last ${DAYS} days:`);
    console.log(`  already on the live policy: ${plan.alreadyLive}`);
    for (const [trigger, n] of Object.entries(plan.byTrigger).sort()) {
      console.log(`  trigger ${trigger}: ${n} → live (trigger ${COACH_SUMMARIZER.triggerTokens})`);
    }
    console.log(`  to write: ${plan.toWrite.length}`);
    if (!WRITE) {
      console.log('\nDry run — nothing written. Re-run with --write to apply.');
      return;
    }
    let written = 0;
    for (const s of plan.toWrite) {
      await updateChatSessionConfig(s.id, withSummarizer(s, policy));
      written += 1;
    }
    console.log(`\n✓ wrote the live policy onto ${written} session(s).`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
