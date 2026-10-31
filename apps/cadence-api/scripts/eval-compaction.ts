/**
 * COMPACTION EVAL — after a long conversation is compacted, does the summary still carry what
 * mattered? Parcel P3 of docs/cadence/HARNESS-V3.md; the check on the owner's "compact around 75K"
 * ruling (R1).
 *
 * MANUAL, NOT CI. It calls the live `coach-compact` job through AI Admin (audited like any job), so
 * it costs real tokens — about 2–3 summarizer calls per fixture, a few thousand tokens each — and a
 * summary is stochastic: one run is a signal, `--runs 3` is closer to a verdict.
 *
 * WHAT IT DOES. For each fixture (`eval-compaction-fixtures.ts`): build the rows a real coach
 * session stores (persona, the three pinned blocks, a per-turn context row beside every exchange),
 * play them forward one exchange at a time, and compact exactly when production would — the
 * engine's own `planCompaction` with the live policy (`coach-compaction-policy.ts`). Then check the
 * final summary for every planted fact behind the final mark, and for injected text that should
 * never reach it.
 *
 * WHAT IT DOES NOT DO (yet). It scores the SUMMARY, not her answers. A fact the summary keeps can
 * still be ignored by the coach; asking her the probes over the compacted history is the next arm.
 *
 * Run:
 *   npm run eval:compaction -- --dry                 # free: rounds, sizes, no model calls
 *   npm run eval:compaction                          # one run of every fixture
 *   npm run eval:compaction -- --runs 3 --fixture half-marathon --out /tmp/compaction.md
 *
 * Exit is non-zero only when a summarizer call fails; retention is reported, never gated.
 */
import '../src/config.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJobBySlug } from '../src/ai/aim.ts';
import { COACH_SUMMARIZER } from '../src/services/coach-compaction-policy.ts';
import { COMPACTION_FIXTURES, FACT_KINDS } from './eval-compaction-fixtures.ts';
import {
  buildFixtureRows,
  compactedFacts,
  leaks,
  replayCompaction,
  scoreFact,
  wordCount,
  type CompactionRound,
  type FactResult,
  type Summarize,
} from './eval-compaction-score.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const persona = readFileSync(path.join(root, 'config/ai-admin/cadence-coach.system-prompt.md'), 'utf8');
const EVAL_USER = process.env.CADENCE_DEV_USER_ID || '';
/** Billed tokens per estimate unit, solved against production billing (coach-compaction-policy.ts). */
const BILLED_PER_UNIT = 1.78;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry');
const RUNS = Number(arg('runs') ?? 1);
const ONLY = arg('fixture');
const OUT = arg('out');

const dryRun: Summarize = async () => '(dry run — no summarizer called) '.repeat(40);
const liveRun: Summarize = async (vars) => {
  const res = await runJobBySlug(EVAL_USER, COACH_SUMMARIZER.jobSlug, vars);
  const text = (res.formatted ?? res.raw ?? '').trim();
  if (!text) throw new Error('coach-compact returned an empty summary');
  return text;
};

interface RunResult {
  fixture: string;
  run: number;
  rounds: CompactionRound[];
  facts: FactResult[];
  leaks: string[];
  words: number;
  error?: string;
}

async function runOne(fixtureId: string, run: number): Promise<RunResult> {
  const fixture = COMPACTION_FIXTURES.find((f) => f.id === fixtureId)!;
  const built = buildFixtureRows(fixture, persona);
  try {
    const { rounds } = await replayCompaction(built, COACH_SUMMARIZER, DRY ? dryRun : liveRun);
    const summary = rounds.at(-1)?.summary ?? '';
    const facts = compactedFacts(fixture, built, rounds).map((f) => scoreFact(summary, f));
    return { fixture: fixtureId, run, rounds, facts, leaks: leaks(summary), words: wordCount(summary) };
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { fixture: fixtureId, run, rounds: [], facts: [], leaks: [], words: 0, error };
  }
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—');

function report(results: RunResult[]): string {
  const lines: string[] = [`# Compaction eval — ${new Date().toISOString().slice(0, 16)}Z${DRY ? ' (DRY)' : ''}`, ''];
  lines.push(
    `Policy: trigger ${COACH_SUMMARIZER.triggerTokens} units (~${Math.round((COACH_SUMMARIZER.triggerTokens * BILLED_PER_UNIT) / 1000)}K billed), keep ${COACH_SUMMARIZER.keepLastNTurns} turns.`,
    '',
  );
  for (const r of results) {
    lines.push(`## ${r.fixture} — run ${r.run}`);
    if (r.error) {
      lines.push(`ERROR: ${r.error}`, '');
      continue;
    }
    for (const [i, round] of r.rounds.entries()) {
      lines.push(
        `- round ${i + 1}: after exchange ${round.afterExchange + 1}, history ${round.estimatedTokens} units (~${Math.round((round.estimatedTokens * BILLED_PER_UNIT) / 1000)}K billed); summarized ${round.summarizedRows} rows (${Math.round(round.transcript.length / 4)} units), dropped ${round.droppedAppRows} injected rows; summary ${wordCount(round.summary)} words`,
      );
    }
    for (const f of r.facts) {
      const miss = f.kept ? '' : ` — missing ${f.missing.map((g) => g.join('/')).join(' + ')}`;
      lines.push(`- ${f.kept ? '✓' : '✗'} [${f.kind}, round ${f.round}] ${f.probe}${miss}`);
    }
    lines.push(`- leaks: ${r.leaks.length ? r.leaks.join(', ') : 'none'}; final summary ${r.words} words`, '');
    // The summaries themselves ride only in the file: a miss is only diagnosable against the text.
    if (OUT) {
      for (const [i, round] of r.rounds.entries())
        lines.push(`<details><summary>round ${i + 1} summary</summary>`, '', round.summary, '', '</details>', '');
    }
  }
  const all = results.flatMap((r) => r.facts);
  lines.push('## Retention', '', '| | kept |', '|---|---|');
  lines.push(
    `| all | ${pct(all.filter((f) => f.kept).length, all.length)} (${all.filter((f) => f.kept).length}/${all.length}) |`,
  );
  for (const kind of FACT_KINDS) {
    const k = all.filter((f) => f.kind === kind);
    lines.push(`| ${kind} | ${pct(k.filter((f) => f.kept).length, k.length)} |`);
  }
  for (const round of [1, 2, 3]) {
    const k = all.filter((f) => f.round === round);
    if (k.length)
      lines.push(`| first summarized in round ${round} | ${pct(k.filter((f) => f.kept).length, k.length)} |`);
  }
  const summarizedUnits = results
    .flatMap((r) => r.rounds)
    .reduce((s, x) => s + (x.transcript.length + x.existingSummary.length) / 4, 0);
  lines.push(
    '',
    `Summarizer input across the run: ~${Math.round((summarizedUnits * BILLED_PER_UNIT) / 1000)}K billed tokens.`,
  );
  return lines.join('\n');
}

async function main() {
  if (!DRY && !EVAL_USER) throw new Error('CADENCE_DEV_USER_ID is not set — needed to run coach-compact as a user.');
  const ids = COMPACTION_FIXTURES.map((f) => f.id).filter((id) => !ONLY || id === ONLY);
  if (!ids.length) throw new Error(`No fixture "${ONLY}". Have: ${COMPACTION_FIXTURES.map((f) => f.id).join(', ')}`);

  const results: RunResult[] = [];
  for (let run = 1; run <= RUNS; run++) {
    // Fixtures run side by side; rounds within one fixture are sequential by nature.
    results.push(...(await Promise.all(ids.map((id) => runOne(id, run)))));
  }
  const text = report(results);
  console.log(text);
  if (OUT) writeFileSync(OUT, `${text}\n`);
  if (results.some((r) => r.error)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
