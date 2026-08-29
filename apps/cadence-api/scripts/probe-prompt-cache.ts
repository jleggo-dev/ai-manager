/**
 * Does Devs.ai pass OpenAI/Anthropic prompt caching through to us, and does our turn shape
 * actually benefit from it?
 *
 * WHY THIS IS NOT THE TOOL-SELECTION EVAL. That eval opens a FRESH session per case
 * (`eval-tool-selection.ts` → `openSession` inside the per-case loop), so every turn it measures is
 * turn one with nothing before it to cache. Its ~22.8k median is therefore a COLD number by
 * construction, and no amount of re-running it can say whether caching works — the question needs
 * consecutive turns in ONE session.
 *
 * Turn one establishes the prefix; turns two onward should hit it. What we send is append-only
 * (`refreshChangedBlocks` injects a NEW block rather than editing an earlier one), and the persona
 * is snapshotted at session open, so the prefix genuinely is stable across a session — the shape
 * caching wants. This measures whether the provider honours it.
 *
 * Reads `cachedPromptTokens` straight from `cadence.ai_log`, which only carries the field since the
 * SSE transform started reading `input_tokens_details.cached_tokens` (#292). Rows are read BEFORE
 * teardown, because deleting the account cascades the log away with it.
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

const TURNS = [
  'morning — what should i be doing today?',
  'how did last week go for me?',
  'i want to add more protein, what am i averaging?',
  'and remind me what the plan says for tomorrow',
];

async function main(): Promise<void> {
  const { API, missingEnv, setUp, tearDown } = await import('./eval-tool-selection-world.ts');
  const missing = missingEnv();
  if (missing) {
    console.error(missing);
    process.exit(1);
  }
  const { sql } = await import('../src/db/sql.ts');

  let world: Awaited<ReturnType<typeof setUp>> | null = null;
  try {
    world = await setUp(); // seeds the fixture itself

    const open = await fetch(`${API}/coach/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${world.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'ongoing', healthAvailable: false, healthAnswered: true }),
    });
    const sessionId = ((await open.json()) as { sessionId?: string }).sessionId;
    if (!sessionId) throw new Error('could not open a session');
    console.log(`one session, ${TURNS.length} consecutive turns → ${sessionId}\n`);

    for (const [i, text] of TURNS.entries()) {
      const t0 = Date.now();
      const res = await fetch(`${API}/coach/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${world.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      // Drain the SSE stream so the turn completes and persists server-side.
      await res.text();
      console.log(`  turn ${i + 1} sent (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }

    const rows = (await sql`
      select (meta->>'promptTokens')::int       as prompt_tokens,
             (meta->>'cachedPromptTokens')::int as cached_tokens,
             (meta ? 'cachedPromptTokens')      as key_present
      from cadence.ai_log
      where kind = 'coach' and user_id = ${world.userId}
      order by created_at asc`) as Array<{
      prompt_tokens: number | null;
      cached_tokens: number | null;
      key_present: boolean;
    }>;

    console.log(`\n  turn   prompt in    cached   cached%   field present`);
    for (const [i, r] of rows.entries()) {
      const p = r.prompt_tokens ?? 0;
      const c = r.cached_tokens;
      const pct = c != null && p ? `${((c / p) * 100).toFixed(0)}%` : '—';
      console.log(
        `  ${String(i + 1).padStart(4)}   ${String(p).padStart(9)}   ${String(c ?? '—').padStart(7)}   ${pct.padStart(7)}   ${r.key_present}`,
      );
    }

    const present = rows.filter((r) => r.key_present);
    console.log('');
    if (!present.length) {
      console.log('  VERDICT  the field never arrived. Either the deployment predates #292, or Devs.ai');
      console.log('           does not forward input_tokens_details.cached_tokens for this model.');
    } else if (present.every((r) => (r.cached_tokens ?? 0) === 0)) {
      console.log('  VERDICT  the field arrives and reads ZERO on every turn. Caching is passed through');
      console.log('           as a number but never earned — the prefix is not being reused upstream.');
    } else {
      const later = rows.slice(1);
      const p = later.reduce((s, r) => s + (r.prompt_tokens ?? 0), 0);
      const c = later.reduce((s, r) => s + (r.cached_tokens ?? 0), 0);
      console.log(`  VERDICT  caching IS live. Across turns 2-${rows.length}: ${c.toLocaleString()} of`);
      console.log(`           ${p.toLocaleString()} prompt tokens cached (${((c / (p || 1)) * 100).toFixed(0)}%).`);
    }
  } finally {
    await tearDown(world);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(String(e));
    process.exit(1);
  },
);
