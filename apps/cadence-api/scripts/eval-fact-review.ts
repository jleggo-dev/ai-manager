/**
 * FACT REVIEW EVAL — does the weekly `fact-review` job find what disagrees in a file, and stay
 * quiet when nothing does? Parcel P9 of docs/cadence/HARNESS-V3.md (C7).
 *
 * MANUAL, NOT CI. Each case is one live call to the `fact-review` job through AI Admin (audited like
 * any job) — six small calls a run. The job must be SYNCED first (sync-jobs.ts): the slug has to
 * exist in AI Admin even when `--prompt-from-config` replaces its prompt.
 *
 * WHAT IT DOES. Each fixture file (`eval-fact-review-cases.ts`) goes through the production dossier
 * builder and the production output checks (evidence required), so the score is what the service
 * would have written. A case passes when the expected finding comes back under the expected kind,
 * citing the expected facts — or, for a quiet case, when nothing comes back. Extra findings are
 * reported beside the score; each is a question the coach would have been handed.
 *
 * Run:
 *   npm run eval:fact-review -- --dry                  # free: prints the cases and the facts each sends
 *   npm run eval:fact-review                           # one run of every case
 *   npm run eval:fact-review -- --runs 3 --case clean --out /tmp/fact-review.md
 *   npm run eval:fact-review -- --prompt-from-config   # the repo's prompt, before a prompt edit is synced
 *
 * Exit is non-zero only when a job call fails; the score is reported, never gated.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewDossier, renderDossier } from '../src/services/fact-review-dossier.ts';
import { checkFindings, type CheckedFindings } from '../src/services/fact-review-findings.ts';
import { CASE_TODAY, FACT_REVIEW_CASES, type FactReviewCase } from './eval-fact-review-cases.ts';
import { scoreCase, summarize, type CaseScore } from './eval-fact-review-score.ts';

const JOB = 'fact-review';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry');
const RUNS = Number(arg('runs') ?? 1);
const ONLY = arg('case');
const OUT = arg('out');
const PROMPT_FROM_CONFIG = process.argv.includes('--prompt-from-config');

const varsFor = (c: FactReviewCase): Record<string, string> => ({
  facts: renderDossier(buildReviewDossier(c.sources)),
  already_asked: '(none)',
  today: CASE_TODAY,
});

function repoTemplate(): string {
  const cfg = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
    jobs: Array<{ slug: string; config: { promptTemplate?: string } }>;
  };
  const t = cfg.jobs.find((j) => j.slug === JOB)?.config.promptTemplate;
  if (!t) throw new Error(`${JOB} has no promptTemplate in the repo config`);
  return t;
}

function printDry(cases: FactReviewCase[]): void {
  for (const c of cases) {
    const expected = c.expect ? `${c.expect.kind} citing ${c.expect.cites.join(' + ')}` : 'nothing to report';
    console.log(`## ${c.id} — expect ${expected}\n${c.why}\n\n${varsFor(c).facts}\n`);
  }
  console.log(`${cases.length} case(s). Dry run: no job called.`);
}

interface RunResult {
  id: string;
  run: number;
  checked?: CheckedFindings;
  score?: CaseScore;
  error?: string;
}

/** Live AI only past this point: the config (env) and the engine load here, never on --dry. */
async function liveRunner(): Promise<(c: FactReviewCase) => Promise<CheckedFindings>> {
  await import('../src/config.ts');
  const { runJobBySlug } = await import('../src/ai/aim.ts');
  const { interpolateTemplate } = await import('@ai-admin/core');
  const user = process.env.CADENCE_DEV_USER_ID || '';
  if (!user) throw new Error('CADENCE_DEV_USER_ID is not set — needed to run fact-review as a user.');
  return async (c) => {
    const vars = varsFor(c);
    const opts = PROMPT_FROM_CONFIG ? { promptOverride: interpolateTemplate(repoTemplate(), vars) } : {};
    const res = await runJobBySlug(user, JOB, vars, opts);
    return checkFindings(res.formatted ?? res.raw ?? '', buildReviewDossier(c.sources));
  };
}

function report(results: RunResult[]): string {
  const lines = [
    `# Fact review eval — ${new Date().toISOString().slice(0, 16)}Z${PROMPT_FROM_CONFIG ? ' (prompt from repo config)' : ''}`,
    '',
  ];
  for (const r of results) {
    const c = FACT_REVIEW_CASES.find((x) => x.id === r.id)!;
    const expected = c.expect ? `${c.expect.kind} ${c.expect.cites.join('+')}` : 'none';
    if (r.error || !r.score || !r.checked) {
      lines.push(`- ✗ ${r.id} (run ${r.run}) — ERROR: ${r.error}`);
      continue;
    }
    const got = r.checked.findings.map((f) => `${f.kind} ${f.fact_ids.join('+')}`).join('; ') || 'none';
    const dropped = Object.entries(r.checked.dropped)
      .filter(([, n]) => n)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    lines.push(
      `- ${r.score.pass ? '✓' : '✗'} ${r.id} (run ${r.run}) — ${r.score.verdict}; expected ${expected}; got ${got}${dropped ? `; dropped ${dropped}` : ''}`,
    );
    for (const f of r.checked.findings) lines.push(`    - "${f.question}" — ${f.evidence}`);
  }
  const s = summarize(results.flatMap((r) => (r.score ? [r.score] : [])));
  lines.push('', `Passed ${s.passed}/${results.length}; extra findings ${s.extra}.`);
  return lines.join('\n');
}

async function main() {
  const cases = FACT_REVIEW_CASES.filter((c) => !ONLY || c.id === ONLY);
  if (!cases.length) throw new Error(`No case "${ONLY}". Have: ${FACT_REVIEW_CASES.map((c) => c.id).join(', ')}`);
  if (DRY) return printDry(cases);

  const runOne = await liveRunner();
  const results: RunResult[] = [];
  for (let run = 1; run <= RUNS; run++) {
    const batch = await Promise.all(
      cases.map(async (c): Promise<RunResult> => {
        try {
          const checked = await runOne(c);
          return { id: c.id, run, checked, score: scoreCase(c.expect, checked) };
        } catch (e) {
          return { id: c.id, run, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
        }
      }),
    );
    results.push(...batch);
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
