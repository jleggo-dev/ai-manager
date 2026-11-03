/**
 * Audit every stored session with the session checker (walkthrough v3, Phase 3c). Read-only.
 *
 *   node --import tsx apps/cadence-api/scripts/audit-session-tools.ts [--since YYYY-MM-DD] [--user <id>]
 *
 * Runs `checkSession` (@cadence/shared, session-check.ts) over the sessions stored on
 * cadence.occurrences and prints counts by rule and severity, then the first 20 facts with their
 * dates. Nothing is written.
 *
 * BASELINE, 2026-11-02 (the audit that started Phase 3, done by hand over 1,319 items in 225
 * sessions): about 9 real misconfigurations, every one a timed effort done in sets —
 *   - reps with 1 rep per set and the time only in the cue (farmer carries Nov 1 and Aug 31, an
 *     elbow hold);
 *   - a timer with sets where the player ignored `sets` (dead hang 3 × 30 s, suitcase carry, Oct 5)
 *     — fixed by Phase 2, so the checker does not count that shape;
 *   - a timer with no time on it (Sep 6, two holds);
 *   - a check-off counting "3 walks" (Nov 3).
 * More than 20 other items mention seconds only to pace each rep ("pause 2 seconds at the top");
 * those are not findings. Re-run this after a week of new sessions and compare.
 *
 * On a Postgres regex, had this been done in SQL: `\y` is the word boundary; `\b` is a backspace,
 * which is why the first by-hand pass returned 0. This script matches in TypeScript instead.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenv } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const since = arg('since');
const user = arg('user');
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since takes a date as YYYY-MM-DD');
  process.exit(1);
}

const { sql } = await import('../src/db/sql.ts');
const { checkSession } = await import('@cadence/shared');
type Session = import('@cadence/shared').OccurrenceSession;
type Finding = import('@cadence/shared').SessionFinding;

const rows = await sql<Array<{ occurrence_id: string; user_id: string; date: string; session: Session }>>`
  select o.occurrence_id, o.user_id, to_char(o.date, 'YYYY-MM-DD') as date, o.session
  from cadence.occurrences o
  where o.session is not null
    ${since ? sql`and o.date >= ${since}::date` : sql``}
    ${user ? sql`and o.user_id = ${user}` : sql``}
  order by o.date, o.occurrence_id
`;

let items = 0;
let sessionsWithFindings = 0;
const byRule = new Map<string, { error: number; question: number }>();
const facts: Array<{ date: string; finding: Finding }> = [];

for (const row of rows) {
  items += row.session.blocks.reduce((n, b) => n + b.items.length, 0);
  const found = checkSession(row.session);
  if (found.length) sessionsWithFindings += 1;
  for (const f of found) {
    const bucket = byRule.get(f.rule) ?? { error: 0, question: 0 };
    bucket[f.severity] += 1;
    byRule.set(f.rule, bucket);
    facts.push({ date: row.date, finding: f });
  }
}

const scope = [since ? `since ${since}` : 'all dates', user ? `user ${user}` : 'every user'].join(', ');
console.log(`[audit] ${rows.length} stored sessions, ${items} items (${scope})`);
console.log(`[audit] ${sessionsWithFindings} sessions with findings, ${facts.length} findings in all\n`);

const errors = [...byRule.values()].reduce((n, b) => n + b.error, 0);
const questions = [...byRule.values()].reduce((n, b) => n + b.question, 0);
console.log(`rule                 error  question`);
for (const [rule, b] of [...byRule].sort((a, c) => c[1].error + c[1].question - (a[1].error + a[1].question))) {
  console.log(`${rule.padEnd(20)} ${String(b.error).padStart(5)}  ${String(b.question).padStart(8)}`);
}
console.log(`${'total'.padEnd(20)} ${String(errors).padStart(5)}  ${String(questions).padStart(8)}\n`);

console.log(`first ${Math.min(20, facts.length)} facts:`);
for (const { date, finding } of facts.slice(0, 20)) {
  console.log(`- ${date} (${finding.severity}) ${finding.fact}`);
}
process.exit(0);
