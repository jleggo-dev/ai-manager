import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * How big a tool result may be, and what happens when one is bigger.
 *
 * The rule these tests exist to defend is the owner's: *"what if we're getting a json back and we
 * break it?"* A cut JSON payload is either unparseable or — far worse — well-formed and quietly
 * missing half its contents, which nothing downstream can detect. So the structured branch never
 * trims; it replaces. The prose branch cuts and says so.
 */

const getSetting = vi.hoisted(() => vi.fn());
vi.mock('../src/models/app-settings.ts', () => ({ getSetting }));

const {
  TOOL_OUTPUT_CHARS_FLOOR,
  boundToolOutput,
  isStructuredPayload,
  jobDeclaresJson,
  resolveToolOutputChars,
} = await import('../src/services/tool-output-bounds.ts');

type Job = Parameters<typeof boundToolOutput>[1]['job'];

const jsonJob = { config: { expectedResponseFormat: 'json' } } as unknown as Job;
const schemaJob = { config: { expectedSchema: { fields: { a: {} } } } } as unknown as Job;
const proseJob = { config: { expectedResponseFormat: 'text' } } as unknown as Job;

beforeEach(() => {
  getSetting.mockReset();
  getSetting.mockResolvedValue(null);
});

describe('resolveToolOutputChars — most specific tier wins', () => {
  it('prefers the per-tool binding over everything else', async () => {
    const limit = await resolveToolOutputChars({
      binding: { maxOutputChars: 1_000 },
      profile: {
        runtime_options: { tools: { max_output_chars: 2_000 } },
        provider: { max_tool_output_chars: 3_000 },
      } as never,
    });
    expect(limit).toBe(1_000);
  });

  it('falls to the profile when the tool says nothing', async () => {
    const limit = await resolveToolOutputChars({
      binding: { maxOutputChars: null },
      profile: {
        runtime_options: { tools: { max_output_chars: 2_000 } },
        provider: { max_tool_output_chars: 3_000 },
      } as never,
    });
    expect(limit).toBe(2_000);
  });

  it('falls to the provider on the profile when neither is set', async () => {
    const limit = await resolveToolOutputChars({
      profile: { runtime_options: {}, provider: { max_tool_output_chars: 3_000 } } as never,
    });
    expect(limit).toBe(3_000);
  });

  it('falls to the app setting, then the code floor', async () => {
    getSetting.mockResolvedValueOnce({ value: { value: 4_000 } });
    expect(await resolveToolOutputChars({})).toBe(4_000);

    getSetting.mockResolvedValueOnce(null);
    expect(await resolveToolOutputChars({})).toBe(TOOL_OUTPUT_CHARS_FLOOR);
  });

  /** A settings outage must not fail a tool call — it falls through to the floor. */
  it('survives a settings read that throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSetting.mockRejectedValueOnce(new Error('db down'));
    expect(await resolveToolOutputChars({})).toBe(TOOL_OUTPUT_CHARS_FLOOR);
  });

  /** Zero and junk mean "inherit", never "unbounded" and never "zero". */
  it('treats 0 and nonsense as unset', async () => {
    getSetting.mockResolvedValue(null);
    const limit = await resolveToolOutputChars({
      binding: { maxOutputChars: 0 },
      profile: { runtime_options: { tools: { max_output_chars: 'lots' } }, provider: {} } as never,
    });
    expect(limit).toBe(TOOL_OUTPUT_CHARS_FLOOR);
  });
});

describe('structured payloads are replaced, never cut', () => {
  const bigJson = JSON.stringify({ rows: Array.from({ length: 500 }, (_, i) => ({ i, name: `row ${i}` })) });

  it('returns a parseable error object instead of a fragment', () => {
    const result = boundToolOutput(bigJson, { limit: 500, job: jsonJob, tool: 'search_rows' });

    expect(result.strategy).toBe('replaced');
    const parsed = JSON.parse(result.output) as Record<string, unknown>;
    expect(parsed.error).toBe('output_too_large');
    expect(parsed.bytes).toBe(bigJson.length);
    expect(parsed.limit).toBe(500);
    expect(parsed.tool).toBe('search_rows');
  });

  /** The failure this whole design exists to prevent. */
  it('never emits a prefix of the original payload', () => {
    const result = boundToolOutput(bigJson, { limit: 500, job: jsonJob });
    expect(result.output.startsWith(bigJson.slice(0, 100))).toBe(false);
    expect(result.output).not.toContain('row 4');
    expect(() => JSON.parse(result.output)).not.toThrow();
  });

  it('says the data was discarded rather than shortened, so a partial read is impossible', () => {
    const result = boundToolOutput(bigJson, { limit: 500, job: jsonJob });
    expect(String(JSON.parse(result.output).hint)).toMatch(/not truncated|no partial data/i);
  });

  it('recognises a JSON job by expectedSchema as well as expectedResponseFormat', () => {
    expect(jobDeclaresJson(schemaJob)).toBe(true);
    expect(jobDeclaresJson(jsonJob)).toBe(true);
    expect(jobDeclaresJson(proseJob)).toBe(false);
  });

  /** Belt and braces: a job that returns JSON without declaring it is the dangerous case. */
  it('protects undeclared JSON by parsing it', () => {
    const undeclared = { config: {} } as unknown as Job;
    expect(isStructuredPayload(bigJson, undeclared)).toBe(true);
    expect(boundToolOutput(bigJson, { limit: 500, job: undeclared }).strategy).toBe('replaced');
  });

  it('treats JSON-looking-but-invalid text as prose — there is no structure left to protect', () => {
    const broken = '{"rows": [' + 'x'.repeat(2_000);
    expect(isStructuredPayload(broken, null)).toBe(false);
  });
});

describe('prose is cut at a line boundary and told so', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `- row ${i} with some detail`).join('\n');

  it('truncates, announces it, and does not end mid-row', () => {
    const result = boundToolOutput(lines, { limit: 1_000, job: proseJob });

    expect(result.strategy).toBe('truncated');
    expect(result.output).toContain('TRUNCATED');
    expect(result.output).toMatch(/narrower query|fewer items/i);
    const body = result.output.slice(0, result.output.indexOf('\n\n[TRUNCATED'));
    expect(body.endsWith('\n')).toBe(false);
    // Every kept line is a whole line from the original.
    for (const line of body.split('\n')) expect(lines).toContain(line);
  });

  it('stays within the limit it was given, notice included', () => {
    const result = boundToolOutput(lines, { limit: 1_000, job: proseJob });
    expect(result.output.length).toBeLessThanOrEqual(1_000);
  });

  it('still cuts when there is no line break to cut on', () => {
    const wall = 'x'.repeat(5_000);
    const result = boundToolOutput(wall, { limit: 1_000, job: proseJob });
    expect(result.strategy).toBe('truncated');
    expect(result.output).toContain('TRUNCATED');
    expect(result.output.length).toBeLessThanOrEqual(1_000);
  });
});

describe('under the limit nothing happens at all', () => {
  it('passes a small result through byte for byte', () => {
    const small = JSON.stringify({ weight_lb: 181 });
    const result = boundToolOutput(small, { limit: 32_000, job: jsonJob });
    expect(result.output).toBe(small);
    expect(result.bounded).toBe(false);
    expect(result.strategy).toBe('none');
  });
});
