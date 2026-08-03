/**
 * Remote AI Admin adapter — run **jobs** against a deployed AI Admin over HTTP instead of the
 * in-process engine.
 *
 * Why this exists: the in-process path (`aim.ts`) imports the engine, which reads provider API
 * keys straight out of the shared database — and those rows are AES-GCM ciphertext, so it needs
 * `CREDENTIAL_ENCRYPTION_KEY` to use them. A machine without that key can still run everything
 * else (the Cadence database, the plan, every tool), but every model call dies as a provider 401.
 *
 * The deployed AI Admin already holds that key and the real provider credentials. So when an AI
 * Admin API key is configured, jobs go **over the wire to the deployment** and it does the
 * decrypting. Local development gets a working coach without ever holding a provider secret.
 *
 * **Job path only.** Coach *chat* is a streaming SSE session whose response body is relayed
 * straight to the client — that stays in-process, and is the one thing this mode can't offer.
 * Everything else (prescribe-session, day-recap, capture-extract, compose-now-menu, plan
 * synthesis and vetting) runs through here.
 */

interface RemoteJobResult {
  raw?: string;
  formatted?: string;
  metadata?: { model?: string; durationMs?: number };
}

const KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const RAW_BASE = process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app';
// The deployment serves the engine under /_/backend; a localhost or already-suffixed base is
// taken as-is. Same normalization the sync script uses, so both agree on one URL.
const BASE =
  RAW_BASE.includes('/_/backend') || RAW_BASE.includes('localhost')
    ? RAW_BASE.replace(/\/+$/, '')
    : `${RAW_BASE.replace(/\/+$/, '')}/_/backend`;

/**
 * Remote mode is opt-in and off by default: it turns on only when an API key is present AND
 * `CADENCE_AI_REMOTE` isn't explicitly disabled. Production runs the engine in-process (no HTTP
 * hop, no second network dependency), so this must never switch itself on there by accident.
 */
export function remoteJobsEnabled(): boolean {
  if (process.env.CADENCE_AI_REMOTE === '0' || process.env.CADENCE_AI_REMOTE === 'false') return false;
  if (process.env.CADENCE_AI_REMOTE === '1' || process.env.CADENCE_AI_REMOTE === 'true') return Boolean(KEY);
  // Default on for local development when a key is available, off everywhere else.
  return Boolean(KEY) && process.env.NODE_ENV !== 'production';
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI Admin ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** slug → id, resolved once. The deployment's job ids are stable, so a process-local map is enough. */
const idBySlug = new Map<string, string>();

async function resolveJobId(slug: string): Promise<string> {
  const hit = idBySlug.get(slug);
  if (hit) return hit;
  const body = await api<{ data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
    'GET',
    '/api/processing-jobs',
  );
  const list = Array.isArray(body) ? body : (body.data ?? []);
  for (const j of list) {
    if (typeof j.slug === 'string' && typeof j.id === 'string') idBySlug.set(j.slug, j.id);
  }
  const found = idBySlug.get(slug);
  if (!found) throw new Error(`AI Admin has no job with slug "${slug}" (is it synced?)`);
  return found;
}

/**
 * Execute a job on the deployment. `/:id/test` is named for the admin UI but is the real
 * execution path — same provider resolution, prompt interpolation, model call and formatting
 * rules as an in-process run — and it returns the same `raw`/`formatted` pair callers read.
 */
export async function remoteRunJobById(
  jobId: string,
  callingApplication: string,
  variables: Record<string, unknown>,
): Promise<RemoteJobResult> {
  return api<RemoteJobResult>('POST', `/api/processing-jobs/${jobId}/test`, { variables, callingApplication });
}

export async function remoteRunJobBySlug(
  slug: string,
  callingApplication: string,
  variables: Record<string, unknown>,
): Promise<RemoteJobResult> {
  return remoteRunJobById(await resolveJobId(slug), callingApplication, variables);
}

/** Where jobs are being run — logged once at startup so it's never a mystery which path is live. */
export function remoteJobsTarget(): string {
  return BASE;
}
