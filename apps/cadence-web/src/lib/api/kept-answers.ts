import { BASE, headers } from './http.ts';
import { onAppResume } from '../app-resume.ts';

/**
 * A request whose answer is kept for us on the server — how a long read survives the phone
 * being left (owner, 2026-11-03: "if a food lookup is in flight and I switch apps or lock the
 * screen, the lookup stops").
 *
 * iOS suspends the webview the moment the app leaves the screen. A fetch in flight at that
 * moment comes back to a socket that errors ("The network connection was lost") or never settles.
 * Until now that was the end of the read: the error was shown as a fault, or the bound fired
 * minutes later and said it took too long, while the server had finished the work and had
 * nowhere to send it. Soft-fail is not an answer (memory, 2026-09-05) — least of all when the
 * answer exists.
 *
 * So a long POST goes out under a request id this client mints, and the API keeps the answer
 * under that id (services/kept-answers.ts, GET /answers/:id). `postKept` then has more than one
 * way to get it:
 *
 *   - the POST answers (200) → the answer, as always; 202 → the server already holds a run under
 *     this id (we re-sent), so ask after it;
 *   - the POST dies → ask after the answer until it is `done` (the answer) or `failed` (the same
 *     refusal the server would have sent live), keep asking while it is `running`, re-send ONCE
 *     when the server says `unknown` (it never arrived), and report `lost` as a fault of ours
 *     with a way to try again — never as "nothing found";
 *   - the app comes back to the foreground with the POST still in the air → ask at once, in
 *     parallel, because that fetch may be a corpse that will never settle; whichever answers
 *     first wins;
 *   - `resume` (a read reopened after the app was relaunched, features/food/readInProgress.ts)
 *     → start by asking, with nothing to send.
 *
 * Bounds that keep this honest: the caller's own `signal` stops everything at once (leaving the
 * door, superseding the read); `timeoutMs` is the whole operation's bound, checked after each
 * ask so a phone that was away past it still gets ONE look at an answer that landed; offline is
 * reported at once (the browser says so, or two asks in a row cannot reach the server), never
 * spun on until the bound; and an id the server does not know after a re-send is reported as the
 * failure it is, a few asks later.
 */

/** How often to ask after an answer we are waiting on. */
export const ANSWER_POLL_MS = 1_500;
/** Asks the server still answers `unknown` to after the re-send went out, before it counts as never sent. */
const UNKNOWN_AFTER_RESEND_MAX = 3;
/** Asks in a row that could not reach the server before the read is reported as unreachable. */
const UNREACHABLE_MAX = 2;

export type KeptAnswerStatus =
  | { status: 'unknown' }
  | { status: 'running'; started_at: string }
  | { status: 'done'; answer: unknown }
  | { status: 'failed'; fault: { status: number; error: string } }
  | { status: 'lost' };

/** What a caller may add to a kept read: its own stop, and a remembered id to pick up again. */
export interface KeptReadOptions {
  /** The caller's own stop — aborts at once with the signal's reason, whatever is in the air. */
  signal?: AbortSignal;
  /** An id minted earlier (newRequestId) — so a surface can remember what it is waiting on. */
  requestId?: string;
  /** Pick a remembered read up again: ask after the answer first, send only if the server never got it. */
  resume?: boolean;
  /** Test seam: how often to ask (ANSWER_POLL_MS). */
  pollMs?: number;
}

export interface PostKeptOptions extends KeptReadOptions {
  /** The whole operation's bound; past it, a read with no answer is reported as taking too long. */
  timeoutMs: number;
  /** The call's name in an error ("meal preview"), as the plain fetch used to word it. */
  label: string;
}

/** A fresh request id. `crypto.randomUUID` arrived with Safari 15.4; older webviews get the same shape by hand. */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Ask the server what became of a request. Throws (with `status`) when the ask itself fails. */
export async function fetchKeptAnswer(requestId: string): Promise<KeptAnswerStatus> {
  const res = await fetch(`${BASE}/answers/${encodeURIComponent(requestId)}`, { headers: headers() });
  if (!res.ok) throw Object.assign(new Error(`answer lookup failed: ${res.status}`), { status: res.status });
  return (await res.json()) as KeptAnswerStatus;
}

const withStatus = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status, ...extra });
const tookTooLong = () => new DOMException('took too long', 'TimeoutError');
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * POST `body` to `path` under a request id, and get the answer back however the connection fares.
 * Resolves with the answer; rejects with the server's refusal (`status`), the caller's abort
 * reason, a TimeoutError at the bound, the network's own error when offline, or — for a run the
 * server lost — an error with `status` 500 and `lost: true`.
 */
export function postKept<T>(path: string, body: Record<string, unknown>, opts: PostKeptOptions): Promise<T> {
  const requestId = opts.requestId ?? newRequestId();
  const pollMs = opts.pollMs ?? ANSWER_POLL_MS;
  const deadline = Date.now() + opts.timeoutMs;
  const sending = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let asking = false;
    /** Sends so far: the first, and at most one re-send when the server says it never arrived. */
    let sends = 0;
    let unknownAfterSend = 0;
    let unreachable = 0;
    let lastError: unknown;

    const stopResume = onAppResume(() => void ask());
    const onCallerStop = () => fail(opts.signal?.reason ?? new DOMException('aborted', 'AbortError'));
    opts.signal?.addEventListener('abort', onCallerStop, { once: true });
    // At the bound, the live POST (if any) is dropped and the ask loop takes one last look.
    const bound = setTimeout(() => sending.abort(tookTooLong()), opts.timeoutMs);

    const finish = (end: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(bound);
      stopResume();
      opts.signal?.removeEventListener('abort', onCallerStop);
      if (!sending.signal.aborted) sending.abort(new DOMException('settled', 'AbortError'));
      end();
    };
    const done = (answer: T) => finish(() => resolve(answer));
    const fail = (err: unknown) => finish(() => reject(err));

    async function send(): Promise<void> {
      sends += 1;
      unknownAfterSend = 0;
      try {
        const res = await fetch(`${BASE}${path}`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ ...body, request_id: requestId }),
          signal: sending.signal,
        });
        if (settled) return;
        if (res.status === 202) return void ask();
        if (!res.ok) return fail(withStatus(`${opts.label} failed: ${res.status}`, res.status));
        done((await res.json()) as T);
      } catch (err) {
        if (settled) return;
        // The connection died — the app left the screen, the network blinked, the bound passed.
        // The server may well still be working, or finished: ask, rather than report a dead
        // socket as the verdict. Offline is the one case where asking cannot help.
        lastError = err;
        if (offline()) return fail(err);
        void ask();
      }
    }

    async function ask(): Promise<void> {
      if (asking || settled) return;
      asking = true;
      try {
        for (;;) {
          if (settled) return;
          let s: KeptAnswerStatus | null = null;
          try {
            s = await fetchKeptAnswer(requestId);
            unreachable = 0;
          } catch (err) {
            lastError = err;
            if (offline() || ++unreachable >= UNREACHABLE_MAX) return fail(err);
          }
          if (settled) return;
          if (s?.status === 'done') return done(s.answer as T);
          if (s?.status === 'failed')
            return fail(withStatus(`${opts.label} failed: ${s.fault.status}`, s.fault.status));
          if (s?.status === 'lost')
            return fail(withStatus(`${opts.label} was lost on the server`, 500, { lost: true }));
          if (s?.status === 'unknown') {
            // Never arrived: send it — the first send on a resume, or one re-send. Sent twice and
            // still unknown after a few asks: the re-send died too, and that is the failure to report.
            if (sends < 2) return void send();
            if (++unknownAfterSend >= UNKNOWN_AFTER_RESEND_MAX) {
              return fail(lastError ?? withStatus(`${opts.label} never reached the server`, 503));
            }
          }
          if (Date.now() >= deadline) return fail(lastError && !s ? lastError : tookTooLong());
          await new Promise((r) => setTimeout(r, pollMs));
        }
      } finally {
        asking = false;
      }
    }

    if (opts.resume) void ask();
    else void send();
  });
}
