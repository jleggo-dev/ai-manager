/**
 * STANDING QUERY: the weekly plan-change latency picture, from cadence.ai_log.
 *
 * PLAN-CHANGES.md's Phase 4 promises "a standing query for the weekly latency picture, so
 * regressions are seen before users feel them" — this is that query, runnable in one command.
 * It reads the instrumentation the plan paths already write (a row on the way in, a row on the
 * way out with `meta.ms`) and prints, per kind:
 *
 *   - evolve_plan       count, p50/p95 ms, fallback rate (meta.fell_back) and the fallback
 *                       reasons — the diff path's hit rate, which is what Phase 1's claim rides on
 *   - synthesize_plan   count, p50/p95 ms, split by phase (draft / reduce / single), ok rate
 *   - coach             count, p50/p95 of meta.ms where present (older rows predate the field)
 *
 * "started, never finished" per kind is the silent-death signal Phase 0 exists for: a started row
 * with no matching exit row means a run died without writing its ending (or is in flight right
 * now — recent starts are normal residue, a growing gap is not).
 *
 * Read-only. Per-model call depth (llm_timing, total_duration_ms, failover legs) lives in AI
 * Admin's diagnostic_logs on the AI Admin Supabase project, not here — see PLAN-CHANGES.md
 * "Measuring" for when to reach for that instead.
 *
 * Run:  node --import tsx apps/cadence-api/scripts/report-plan-latency.ts
 *       DAYS=30 node --import tsx apps/cadence-api/scripts/report-plan-latency.ts
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });
dotenv({ path: path.join(root, 'backend/.env') });

const { sql } = await import('../src/db/sql.ts');

const days = Number(process.env.DAYS ?? 7);

const secs = (v: unknown): string => (v == null ? '—' : `${(Number(v) / 1000).toFixed(1)}s`);
const pad = (s: string, w: number): string => s.padEnd(w);

interface KindStats {
  kind: string;
  started: number;
  finished: number;
  p50: number | null;
  p95: number | null;
}

/** Started rows carry output.started=true and no meta.ms; every exit row (ok, vetoed, failed,
 *  fallback) carries meta.ms — that pairing is the contract this report reads. */
async function kindStats(kind: string): Promise<KindStats> {
  const [row] = await sql<{ started: string; finished: string; p50: string | null; p95: string | null }[]>`
    select
      count(*) filter (where output->>'started' = 'true') as started,
      count(*) filter (where meta ? 'ms') as finished,
      percentile_cont(0.5) within group (order by (meta->>'ms')::numeric) filter (where meta ? 'ms') as p50,
      percentile_cont(0.95) within group (order by (meta->>'ms')::numeric) filter (where meta ? 'ms') as p95
    from cadence.ai_log
    where kind = ${kind} and created_at > now() - make_interval(days => ${days})`;
  return {
    kind,
    started: Number(row?.started ?? 0),
    finished: Number(row?.finished ?? 0),
    p50: row?.p50 == null ? null : Number(row.p50),
    p95: row?.p95 == null ? null : Number(row.p95),
  };
}

function printHeader(): void {
  console.log(`plan-change latency — last ${days} day(s), cadence.ai_log\n`);
  console.log([pad('kind', 26), pad('started', 8), pad('finished', 9), pad('p50', 9), pad('p95', 9), 'notes'].join(''));
}

function printRow(s: KindStats, notes: string): void {
  console.log(
    [
      pad(s.kind, 26),
      pad(String(s.started), 8),
      pad(String(s.finished), 9),
      pad(secs(s.p50), 9),
      pad(secs(s.p95), 9),
      notes,
    ].join(''),
  );
}

async function evolveNotes(): Promise<string> {
  const [row] = await sql<{ finished: string; fell_back: string }[]>`
    select count(*) as finished, count(*) filter (where meta->>'fell_back' = 'true') as fell_back
    from cadence.ai_log
    where kind = 'evolve_plan' and meta ? 'ms' and created_at > now() - make_interval(days => ${days})`;
  const finished = Number(row?.finished ?? 0);
  const fell = Number(row?.fell_back ?? 0);
  if (!finished) return 'no finished runs';
  const rate = `${fell}/${finished} fell back (${Math.round((100 * fell) / finished)}%)`;
  if (!fell) return rate;
  const reasons = await sql<{ why: string; n: string }[]>`
    select coalesce(meta->>'why', '?') as why, count(*) as n
    from cadence.ai_log
    where kind = 'evolve_plan' and meta->>'fell_back' = 'true'
      and created_at > now() - make_interval(days => ${days})
    group by 1 order by 2 desc`;
  return `${rate} — ${reasons.map((r) => `${r.why}×${r.n}`).join(', ')}`;
}

/** A fan-out over N goals is N draft calls + one reduce; only the phase split shows which
 *  shape is slow (plan-synthesis.ts logs meta.phase for exactly this reason). */
async function synthesizePhases(): Promise<void> {
  const rows = await sql<{ phase: string; n: string; p50: string | null; p95: string | null; ok: string }[]>`
    select coalesce(meta->>'phase', '?') as phase, count(*) as n,
      percentile_cont(0.5) within group (order by (meta->>'ms')::numeric) as p50,
      percentile_cont(0.95) within group (order by (meta->>'ms')::numeric) as p95,
      count(*) filter (where meta->>'ok' = 'true') as ok
    from cadence.ai_log
    where kind = 'synthesize_plan' and meta ? 'ms' and created_at > now() - make_interval(days => ${days})
    group by 1 order by 2 desc`;
  for (const r of rows) {
    console.log(
      [
        pad(`  · ${r.phase}`, 26),
        pad('', 8),
        pad(String(r.n), 9),
        pad(secs(r.p50), 9),
        pad(secs(r.p95), 9),
        `${r.ok}/${r.n} ok`,
      ].join(''),
    );
  }
}

async function coachNotes(finished: number): Promise<string> {
  if (!finished) return 'meta.ms not on any row yet (rows predate the field)';
  const [row] = await sql<{ rounds: string | null }[]>`
    select percentile_cont(0.5) within group (order by (meta->>'toolRounds')::numeric) as rounds
    from cadence.ai_log
    where kind = 'coach' and meta ? 'toolRounds' and created_at > now() - make_interval(days => ${days})`;
  return row?.rounds == null ? '' : `p50 toolRounds ${Number(row.rounds).toFixed(1)}`;
}

printHeader();

const evolve = await kindStats('evolve_plan');
printRow(evolve, await evolveNotes());

const synth = await kindStats('synthesize_plan');
printRow(synth, `${synth.started - synth.finished} started without a recorded ending`);
await synthesizePhases();

// The coach turn has no started/exit pair — one row per turn. `started` is meaningless here;
// show total rows instead, and percentiles over the rows that carry meta.ms.
const [coachTotal] = await sql<{ n: string }[]>`
  select count(*) as n from cadence.ai_log
  where kind = 'coach' and created_at > now() - make_interval(days => ${days})`;
const coach = await kindStats('coach');
coach.started = Number(coachTotal?.n ?? 0);
printRow({ ...coach, kind: 'coach (rows, not runs)' }, await coachNotes(coach.finished));

console.log(
  '\nbudgets (PLAN-CHANGES.md): small evolve < 60s · rebalance evolve < 300s now, 120s target · ' +
    'assert them live with scripts/probe-plan-latency.ts',
);

await sql.end();
