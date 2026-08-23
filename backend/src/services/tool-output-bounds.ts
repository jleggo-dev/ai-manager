/**
 * How big a tool result is allowed to be, and what to do when one is bigger.
 *
 * A tool result is an unbounded prompt wearing a return value. The output of a job-as-tool is
 * whatever an LLM wrote, and it goes straight into the next request — alongside every earlier
 * round's exchange, since the continuation is self-contained (#232, #277). Nothing here capped it.
 *
 * TRUNCATION IS THE LAST LAYER, NOT THE STRATEGY. Owner's ruling, and it is the right one: the
 * real fix for a large result is to not produce it — a bounded array in the job's `expectedSchema`
 * is ENFORCED by the provider, a row ceiling in the prompt is asked for, and a tool description
 * that teaches a narrower argument is what stops the model requesting the world in the first
 * place. Everything in this file is the circuit breaker behind those three, for the case where
 * they were not enough. A cap is not a formatter.
 *
 * WHICH IS WHY IT MUST NOT CUT JSON. Owner: *"what if we're getting a json back and we break
 * it?"* Cutting a structured payload yields either unparseable text or — far worse — a
 * well-formed object that is quietly missing half its contents, which no downstream reader can
 * detect. So overflow branches on what the payload actually is:
 *
 *   · structured → the whole payload is REPLACED by a small, valid error object. Parseable,
 *     honest, and actionable: the model can read the limit and retry with a narrower call.
 *   · prose      → cut at a line boundary and say so, the shape `boundToolResponse` was built
 *     for in `apps/cadence-api/src/services/tool-response.ts` (TOOL-HARNESS step 4).
 *
 * Mangled JSON is strictly worse than no JSON, so the structured branch never trims.
 *
 * The same principle governs the input side already: `interpolateTemplate` clamps a job variable
 * at `MAX_VARIABLE_LENGTH` and appends `... [truncated]`. Bounded, and it says so. This file is
 * that principle finally reaching the output side.
 */
import { getSetting } from '../models/app-settings.ts';
import type { AiProfileRow, ProcessingJobRow, ProviderRow } from '../types.ts';

/**
 * The last-resort ceiling, used only when nothing is configured anywhere.
 *
 * ~8k tokens: generous beside any legitimate job result, small beside a 1M-token window, and
 * finite — which is the whole point, because the tier below this one is "unbounded forever".
 * Anthropic caps Claude Code's tool results at 25,000 tokens and Cadence's own renders at 7,400
 * characters; this sits between a platform's ceiling and one app's tuned value, because AI Admin
 * serves consumers whose result shapes it does not know.
 *
 * It is deliberately NOT the knob. Anything that knows something specific — a tool, a profile, a
 * provider — should say so at its own tier and this should never be reached.
 */
export const TOOL_OUTPUT_CHARS_FLOOR = 32_000;

/** Lower bound on a configured value: below this even an error object stops fitting. */
export const TOOL_OUTPUT_CHARS_MIN = 500;

export const TOOL_OUTPUT_SETTING_KEY = 'default_tool_output_chars';

/** A positive, finite integer, or null — the same coercion `resolveTimeoutMs` does inline. */
function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export interface ToolOutputLimitSources {
  /** The `toolJobs[]` entry the model called — the tier that knows the most. */
  binding?: { maxOutputChars?: number | null } | null;
  profile?: AiProfileRow | null;
  /** Defaults to `profile.provider` when omitted. */
  provider?: ProviderRow | null;
}

/** Per-profile tier: `runtime_options.tools.max_output_chars`. */
function profileLimit(profile: AiProfileRow | null | undefined): number | null {
  const opts = profile?.runtime_options as { tools?: { max_output_chars?: unknown } } | null | undefined;
  return positiveInt(opts?.tools?.max_output_chars);
}

/**
 * Most specific wins, exactly like `resolveTimeoutMs` (job → provider → app setting → code floor).
 *
 * The app setting exists so that nothing is ever unbounded, not because anyone should tune there:
 * one number cannot be right for a tool returning a weight and a tool returning a week of rows.
 * The tiers above it are where the knowledge is.
 */
export async function resolveToolOutputChars(sources: ToolOutputLimitSources = {}): Promise<number> {
  const perTool = positiveInt(sources.binding?.maxOutputChars);
  if (perTool) return Math.max(perTool, TOOL_OUTPUT_CHARS_MIN);

  const perProfile = profileLimit(sources.profile);
  if (perProfile) return Math.max(perProfile, TOOL_OUTPUT_CHARS_MIN);

  const provider = sources.provider ?? sources.profile?.provider ?? null;
  const perProvider = positiveInt(provider?.max_tool_output_chars);
  if (perProvider) return Math.max(perProvider, TOOL_OUTPUT_CHARS_MIN);

  try {
    const setting = await getSetting(TOOL_OUTPUT_SETTING_KEY);
    const configured = positiveInt((setting?.value as Record<string, unknown> | null)?.value);
    if (configured) return Math.max(configured, TOOL_OUTPUT_CHARS_MIN);
  } catch (err) {
    // A settings read that fails must not fail the tool call — fall through to the floor.
    console.warn('[tool-output-bounds] settings lookup failed, using the floor:', err);
  }

  return TOOL_OUTPUT_CHARS_FLOOR;
}

/** Does this job DECLARE that it returns JSON? 28 of the shipped jobs do. */
export function jobDeclaresJson(job: ProcessingJobRow | null | undefined): boolean {
  const config = job?.config as { expectedSchema?: unknown; expectedResponseFormat?: unknown } | undefined;
  if (config?.expectedSchema) return true;
  return String(config?.expectedResponseFormat ?? '')
    .trim()
    .toLowerCase()
    .includes('json');
}

/**
 * Would cutting this payload break it?
 *
 * Belt AND braces on purpose. The declaration is the cheap answer and it is usually right, but a
 * job that returns JSON without declaring it is exactly the case where a wrong guess destroys
 * data — so an actual parse gets the final word. This only runs on the overflow path, so the cost
 * lands on the pathological result rather than on every call.
 */
export function isStructuredPayload(output: string, job?: ProcessingJobRow | null): boolean {
  if (jobDeclaresJson(job)) return true;
  const trimmed = output.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // Starts like JSON and is not JSON. Treat it as prose: there is no structure left to protect,
    // and a cut cannot make an already-unparseable payload worse.
    return false;
  }
}

/**
 * What a structured tool hands back when its real answer did not fit.
 *
 * Valid JSON, small, and it names the numbers — a model that can read `limit` and `bytes` can
 * decide to ask for less, which is the only useful thing to do about it. `error` is a literal
 * marker rather than prose so a caller can branch on it without matching English.
 */
export function toolOutputTooLargeJson(args: { bytes: number; limit: number; tool?: string }): string {
  return JSON.stringify({
    error: 'output_too_large',
    bytes: args.bytes,
    limit: args.limit,
    ...(args.tool ? { tool: args.tool } : {}),
    hint:
      'This result was discarded because it exceeded the size limit — it was NOT truncated, so no ' +
      'partial data is included here. Call again with a narrower query, a filter, or fewer items.',
  });
}

/** Cut prose at a line boundary and say so, so a partial answer is never read as a complete one. */
export function truncateProse(output: string, limit: number): string {
  const notice =
    '\n\n[TRUNCATED — this is only the first part of the result, not all of it. Call again with a ' +
    'narrower query or fewer items if you need the rest, and do not report this as everything.]';
  const room = Math.max(TOOL_OUTPUT_CHARS_MIN, limit - notice.length);
  const head = output.slice(0, room);
  // Prefer a clean line break so a row is never sliced in half and misread as data. Only when the
  // break is reasonably far in — otherwise a single long line would cut back to almost nothing.
  const cut = head.lastIndexOf('\n');
  const kept = cut > room * 0.6 ? head.slice(0, cut) : head;
  return kept + notice;
}

export interface BoundToolOutputResult {
  output: string;
  /** True when the payload did not fit — worth logging, and the tests assert on it. */
  bounded: boolean;
  /** How it was handled, for the log line: a discarded object or a cut string. */
  strategy: 'none' | 'replaced' | 'truncated';
  originalBytes: number;
}

/**
 * Apply the limit to one tool result. Never throws — a bounding failure must not fail the call.
 */
export function boundToolOutput(
  output: string,
  args: { limit: number; job?: ProcessingJobRow | null; tool?: string },
): BoundToolOutputResult {
  const originalBytes = output.length;
  if (originalBytes <= args.limit) {
    return { output, bounded: false, strategy: 'none', originalBytes };
  }

  if (isStructuredPayload(output, args.job)) {
    return {
      output: toolOutputTooLargeJson({ bytes: originalBytes, limit: args.limit, tool: args.tool }),
      bounded: true,
      strategy: 'replaced',
      originalBytes,
    };
  }

  return {
    output: truncateProse(output, args.limit),
    bounded: true,
    strategy: 'truncated',
    originalBytes,
  };
}
