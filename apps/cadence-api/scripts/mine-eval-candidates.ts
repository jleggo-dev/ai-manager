/**
 * MINE EVAL CANDIDATES — real coach turns that look like failures, written to a file a person reads
 * (HARNESS-V3 C5.1).
 *
 * The tool-selection cases are only as good as the failures they came from, and every one so far
 * was found by the owner noticing something on his phone. The logs already hold every coach turn;
 * this reads them and flags the turns that match a known failure shape (`eval-mine-patterns.ts`):
 * she promised a change and no action ran, a tool told her it broke, the person corrected her in
 * their next message, or the turn took over 120 s.
 *
 * NOTHING BECOMES A CASE AUTOMATICALLY. The output is a markdown review file with an empty
 * "promote as:" line per candidate. The owner or an agent reads it and, for the ones worth keeping,
 * writes a case into `eval-tool-selection-cases.ts` by hand with a `from:` line naming the session
 * and date, the shape the cases already use. The file holds real people's words, so it is
 * gitignored and stays on the machine that ran this.
 *
 * WHERE THE TURNS COME FROM, and what identifies one:
 *   - AI Admin `diagnostic_logs`: one row per coach turn, written after her reply is on file
 *     (`recordCoachReply` → `DiagnosticSession.complete`). A coach turn is a row whose
 *     `processing_job_id` is the coach chat job (`cadence-coach-chat`) AND whose `chat_session_id`
 *     is set. Every such row has `calling_application` 'platform:cadence'; the job id is what tells
 *     it apart from Broker jobs. `llm_request.promptContent` is the person's message as sent,
 *     `llm_response.rawContent` her whole reply, `total_duration_ms` the turn's length.
 *   - Cadence `ai_log` rows of kind `coach_tool`: which tools she called and what they handed back
 *     (first 400 characters). These rows carry the person but NOT the conversation, so they are
 *     joined to a turn by person and time (written between the turn's start and end).
 *   - Turns from accounts no longer on file (the eval's throwaway users, deleted after each run)
 *     and from `@cadence.test` accounts are skipped: they are our own test turns, not failures.
 *
 * Read-only: SELECTs against both databases, nothing written anywhere except the review file.
 *
 * Run:
 *   npm run eval:mine -- --dry                  # the window and the counts per shape; writes nothing
 *   npm run eval:mine                           # last 30 days → apps/cadence-api/eval-candidates-<date>.md
 *   npm run eval:mine -- --days 90 --limit 3000 --out /tmp/candidates.md
 */
import '../src/config.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProcessingJobBySlug, tenantFrom } from '@ai-admin/core';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';
import { sql } from '../src/db/sql.ts';
import { isActionName } from '../src/services/coach-tool-tiers.ts';
import {
  SHAPE_LABEL,
  attachTools,
  findCandidates,
  type Candidate,
  type MinedTurn,
  type Shape,
  type ToolLogRow,
} from './eval-mine-patterns.ts';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry');
const DAYS = Math.max(1, Number(arg('days') ?? 30) || 30);
const LIMIT = Math.max(1, Number(arg('limit') ?? 5000) || 5000);
const ACTOR = 'platform:cadence';
const PAGE = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How much of her reply the review file shows. The person's words are always shown whole. */
const REPLY_CHARS = 600;

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The calendar day where this runs (YYYY-MM-DD), not UTC's: an evening run in the Americas is already tomorrow in UTC. */
const localDay = (d: Date): string => d.toLocaleDateString('en-CA');
const today = localDay(new Date());
const OUT = arg('out') ?? path.join(apiDir, `eval-candidates-${today}.md`);

interface DiagRow {
  chat_session_id: string;
  user_id: string | null;
  created_at: string;
  total_duration_ms: number | null;
  user_text: string | null;
  reply: string | null;
}

/** Coach turns from AI Admin's diagnostic log, oldest first, paged until the window or the limit runs out. */
async function readCoachTurns(since: string): Promise<{ jobId: string; rows: DiagRow[] }> {
  return withAim(ACTOR, async () => {
    const job = (await getProcessingJobBySlug(cadenceConfig.aim.coachJobSlug)) as { id: string } | null;
    if (!job) throw new Error(`no processing job "${cadenceConfig.aim.coachJobSlug}" in AI Admin`);
    const rows: DiagRow[] = [];
    while (rows.length < LIMIT) {
      const from = rows.length;
      const to = Math.min(from + PAGE, LIMIT) - 1;
      const { data, error } = await tenantFrom('diagnostic_logs')
        .select(
          'chat_session_id, user_id, created_at, total_duration_ms, ' +
            'user_text:llm_request->>promptContent, reply:llm_response->>rawContent',
        )
        .eq('processing_job_id', job.id)
        .not('chat_session_id', 'is', null)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .range(from, to);
      if (error) throw new Error(`diagnostic_logs read failed: ${error.message}`);
      const page = (data ?? []) as unknown as DiagRow[];
      rows.push(...page);
      if (page.length < to - from + 1) break;
    }
    return { jobId: job.id, rows };
  });
}

/** The people whose turns are worth reading: still on file, and not a `@cadence.test` account. */
async function realAccounts(userIds: string[]): Promise<Set<string>> {
  const ids = userIds.filter((id) => UUID.test(id));
  if (!ids.length) return new Set();
  const rows = await sql<{ id: string }[]>`
    select id::text as id from cadence.users
    where id = any(${ids}::uuid[]) and coalesce(email, '') not ilike '%@cadence.test'`;
  return new Set(rows.map((r) => r.id));
}

/**
 * Every `coach_tool` row for these people since the window opened. Ten minutes earlier than the
 * window, because a turn logged just inside it started before it (its tools ran before its row).
 */
async function readToolRows(userIds: string[], since: string): Promise<ToolLogRow[]> {
  if (!userIds.length) return [];
  const rows = await sql<{ user_id: string; created_at: Date; input: unknown; output: unknown }[]>`
    select user_id::text as user_id, created_at, input, output from cadence.ai_log
    where kind = 'coach_tool' and user_id = any(${userIds}::uuid[])
      and created_at >= ${since}::timestamptz - interval '10 minutes'
    order by created_at`;
  return rows.map((r) => ({
    userId: r.user_id,
    at: new Date(r.created_at).toISOString(),
    input: r.input,
    output: r.output,
  }));
}

/* ── the review file ───────────────────────────────────────────────────────────────────────── */

const quote = (text: string): string =>
  text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

const trimReply = (text: string): string =>
  text.length <= REPLY_CHARS ? text : `${text.slice(0, REPLY_CHARS).trimEnd()} … [cut at ${REPLY_CHARS} characters]`;

function renderCandidate(c: Candidate, n: number): string {
  const tools = c.turn.tools.map((t) => t.name);
  const lines = [
    `## ${n}. ${c.turn.sessionId} · ${c.turn.at}`,
    '',
    `- **Matched:** ${c.shapes.map((s) => SHAPE_LABEL[s]).join('; ')}`,
    `- **Tools she called:** ${tools.length ? tools.join(', ') : 'none'}`,
    ...(c.faulted.length ? [`- **Tools that reported a fault:** ${c.faulted.join(', ')}`] : []),
    ...(c.turn.ms !== null ? [`- **Turn length:** ${(c.turn.ms / 1000).toFixed(0)} s`] : []),
    '',
    '**What they said:**',
    '',
    quote(c.turn.user || '(empty)'),
    '',
    `**Her reply** (first ${REPLY_CHARS} characters):`,
    '',
    quote(trimReply(c.turn.reply || '(empty)')),
    '',
  ];
  if (c.shapes.includes('corrected-next') && c.next) {
    lines.push('**What they said next:**', '', quote(c.next), '');
  }
  lines.push('promote as: ', '', '---', '');
  return lines.join('\n');
}

function renderFile(opts: {
  since: string;
  read: number;
  skipped: number;
  candidates: Candidate[];
  counts: Record<Shape, number>;
}): string {
  const head = [
    `# Eval candidates, ${localDay(new Date(opts.since))} to ${today}`,
    '',
    'Real coach turns that match a known failure shape, mined by `npm run eval:mine`',
    '(`apps/cadence-api/scripts/mine-eval-candidates.ts`). **Nothing here is a case yet.** To promote',
    'one, write it into `eval-tool-selection-cases.ts` by hand with a `from:` line naming the session',
    'and date, and fill in its "promote as:" line here (the case id, or "no" and why).',
    '',
    "This file holds real people's words. It is gitignored; do not commit it or paste it anywhere.",
    '',
    `- Turns read: ${opts.read} (skipped ${opts.skipped} from test or deleted accounts)`,
    `- Candidates: ${opts.candidates.length}`,
    ...(Object.keys(SHAPE_LABEL) as Shape[]).map((s) => `  - ${SHAPE_LABEL[s]}: ${opts.counts[s]}`),
    '',
    '---',
    '',
  ];
  return [...head, ...opts.candidates.map((c, i) => renderCandidate(c, i + 1))].join('\n');
}

/* ── run ───────────────────────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { jobId, rows } = await readCoachTurns(since);
  const keep = await realAccounts([...new Set(rows.map((r) => r.user_id ?? ''))]);
  const turns: MinedTurn[] = rows
    .filter((r) => r.user_id && keep.has(r.user_id))
    .map((r) => ({
      sessionId: r.chat_session_id,
      at: new Date(r.created_at).toISOString(),
      userId: r.user_id!,
      user: r.user_text ?? '',
      reply: r.reply ?? '',
      ms: r.total_duration_ms,
      tools: [],
    }));
  const withTools = attachTools(turns, await readToolRows([...keep], since));
  const candidates = findCandidates(withTools, isActionName);
  const counts = Object.fromEntries(
    (Object.keys(SHAPE_LABEL) as Shape[]).map((s) => [s, candidates.filter((c) => c.shapes.includes(s)).length]),
  ) as Record<Shape, number>;

  console.log(`coach turns, last ${DAYS} day(s) — since ${localDay(new Date(since))}`);
  console.log(
    `  keyed on: diagnostic_logs.processing_job_id = ${jobId} (${cadenceConfig.aim.coachJobSlug}), chat_session_id set`,
  );
  console.log(
    `  rows read ${rows.length}${rows.length >= LIMIT ? ` (hit --limit ${LIMIT}; raise it to read further)` : ''}`,
  );
  console.log(`  skipped   ${rows.length - turns.length} from test or deleted accounts`);
  console.log(
    `  turns     ${turns.length} in ${new Set(turns.map((t) => t.sessionId)).size} conversation(s), ` +
      `${withTools.filter((t) => t.tools.length).length} with tool calls`,
  );
  console.log(`  candidates ${candidates.length}`);
  for (const s of Object.keys(SHAPE_LABEL) as Shape[]) console.log(`    ${SHAPE_LABEL[s]}: ${counts[s]}`);

  if (DRY) {
    console.log('\n--dry: nothing written.');
    return;
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, renderFile({ since, read: rows.length, skipped: rows.length - turns.length, candidates, counts }));
  console.log(`\nwrote ${OUT}`);
}

main()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await sql.end().catch(() => {});
    process.exit(1);
  });
