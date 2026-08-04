/**
 * Shared plumbing for the live coach probes (`probe-coach-tools.ts`, `probe-plan-shape.ts`).
 *
 * Every probe does the same three things: authenticate to the deployed AI Admin, run a real job by
 * slug through `/test` (which executes but writes nothing to any plan), and count problems so the
 * process can exit non-zero. That's all this module is — the judgment lives in each probe.
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'backend/.env') });

const KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const BASE = (process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app') + '/_/backend';
if (!KEY) throw new Error('No AI_ADMIN_API_KEY');

/** Per-call ceiling. Jobs normally answer in 5–30s; a call still open at two minutes is a hung
 *  connection, not a slow model — and without this, one stall wedged a 21-scenario gate for 15+
 *  minutes (2026-08-04). Abort → the retry in runJob gets its chance; a second stall fails the
 *  run FAST with a clear error instead of hanging it. */
const CALL_TIMEOUT_MS = 120_000;

export async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

const jobIds = new Map<string, string>();
async function jobId(slug: string): Promise<string> {
  if (jobIds.size === 0) {
    const body = (await api('GET', '/api/processing-jobs')) as { data?: unknown[] } | unknown[];
    const list = (Array.isArray(body) ? body : (body.data ?? [])) as Array<Record<string, unknown>>;
    for (const j of list) if (typeof j.slug === 'string' && typeof j.id === 'string') jobIds.set(j.slug, j.id);
  }
  const found = jobIds.get(slug);
  if (!found) throw new Error(`no job "${slug}" on the deployment`);
  return found;
}

export async function runJob(slug: string, variables: Record<string, unknown>): Promise<string> {
  const call = async () =>
    api('POST', `/api/processing-jobs/${await jobId(slug)}/test`, {
      variables,
      callingApplication: 'platform:cadence',
    });
  let out;
  try {
    out = await call();
  } catch (err) {
    // One retry, network-level failures only (ECONNRESET, dropped TLS). A ~20-scenario gate run
    // that dies on a single TCP reset wastes every scenario before it — which happened 2026-08-04,
    // four scenarios into a clean run. HTTP-level errors still throw immediately: a 4xx/5xx is a
    // real answer, not weather.
    const msg = String((err as Error)?.cause ?? (err as Error)?.message ?? err);
    if (!/ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|socket|abort|timeout/i.test(msg)) throw err;
    await new Promise((r) => setTimeout(r, 2000));
    out = await call();
  }
  return String(out.formatted ?? out.raw ?? '');
}

/** Tolerant JSON read — models fence their output and occasionally chat around it. */
export function parseJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** Problem tally — mutable on purpose so `flag` reads like a statement at every call site. */
export const tally = { problems: 0 };

export function flag(msg: string): void {
  tally.problems += 1;
  console.log(`   ⚠ ${msg}`);
}

/** The shared closing line + exit code, so every probe ends the same way. */
export function finish(): never {
  console.log(`\n${tally.problems === 0 ? 'All scenarios behaved.' : `${tally.problems} thing(s) to look at.`}`);
  process.exit(tally.problems === 0 ? 0 : 1);
}
