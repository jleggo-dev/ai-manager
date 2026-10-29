/**
 * The body one Vercel AI Gateway call sends. Table-tested because every row is a thing that
 * went wrong once on the probes (2026-10-29): a Devs.ai field the gateway 400s on, a stored
 * response, a model id "helpfully" rewritten, an open object under `strict: true`.
 */
import { describe, it, expect } from 'vitest';
import { buildGatewayRequest, DEVS_AI_ONLY_OPTIONS } from '../src/integrations/vercel-ai-gateway/request.ts';
import type { ChatMessage } from '../src/types.ts';

const user: ChatMessage[] = [{ role: 'user', content: 'Reply with the single word OK.' }];

describe('buildGatewayRequest — Devs.ai-only fields never leave', () => {
  const devsAiOptions = {
    chat_mode: 'execute',
    thread_mode: 'collect',
    previous_response_id: 'resp_1',
    conversation: 'conv_1',
    timeoutMs: 5000,
  };
  const { body } = buildGatewayRequest('openai/gpt-4.1-mini', user, devsAiOptions);
  const keys = Object.keys(body);

  it.each(DEVS_AI_ONLY_OPTIONS.map((k) => [k]))('drops %s', (key) => {
    expect(keys).not.toContain(key);
  });

  it('does not forward the client-side timeout as a body field', () => {
    expect(keys).not.toContain('timeoutMs');
  });
});

describe('buildGatewayRequest — what always goes', () => {
  it.each([['openai/gpt-4.1-mini'], ['anthropic/claude-sonnet-5.5'], ['google/gemini-3.6-flash'], ['xai/grok-4.6']])(
    'passes the model id %s through untouched',
    (model) => {
      expect(buildGatewayRequest(model, user).body.model).toBe(model);
    },
  );

  it('sends store:false and stream:false even when the caller asked for the opposite', () => {
    const { body } = buildGatewayRequest('openai/gpt-4.1-mini', user, { store: true, stream: true });
    expect(body.store).toBe(false);
    expect(body.stream).toBe(false);
  });

  it('keeps the standard fields: instructions, max_output_tokens, temperature, tools', () => {
    const { body } = buildGatewayRequest('openai/gpt-4.1-mini', [{ role: 'system', content: 'Be brief.' }, ...user], {
      max_output_tokens: 32,
      temperature: 0.2,
      tools: [{ type: 'function', function: { name: 'f', description: 'd', parameters: {} } }],
    });
    expect(body.instructions).toBe('Be brief.');
    expect(body.input).toBe('Reply with the single word OK.');
    expect(body.max_output_tokens).toBe(32);
    expect(body.temperature).toBe(0.2);
    expect(body.tools).toEqual([{ type: 'function', name: 'f', description: 'd', parameters: {} }]);
  });

  it('reports no schema decision when no schema was asked for', () => {
    expect(buildGatewayRequest('openai/gpt-4.1-mini', user).schema).toBeNull();
  });
});

describe('buildGatewayRequest — strict schema', () => {
  it('sends a fully declared schema strict, with every object closed', () => {
    const { body, schema } = buildGatewayRequest('openai/gpt-4.1-mini', user, {
      expectedSchema: {
        fields: {
          marker: { type: 'string' },
          count: { type: 'number' },
          inner: { type: 'object', fields: { a: { type: 'string' } } },
        },
      },
    });
    const format = (body.text as { format: Record<string, unknown> }).format;
    expect(format.strict).toBe(true);
    expect(schema).toEqual({ strict: true, openPaths: [] });
    const inner = (format.schema as { properties: { inner: Record<string, unknown> } }).properties.inner;
    expect(inner.additionalProperties).toBe(false);
    expect(inner.required).toEqual(['a']);
  });

  it('falls back to strict:false when an object has no declared fields, and names it', () => {
    const { body, schema } = buildGatewayRequest('openai/gpt-4.1-mini', user, {
      expectedSchema: {
        fields: {
          flags: { type: 'object' },
          items: { type: 'array', items: { type: 'object' } },
        },
      },
    });
    const format = (body.text as { format: Record<string, unknown> }).format;
    expect(format.strict).toBe(false);
    expect(format.type).toBe('json_schema');
    expect(schema).toEqual({ strict: false, openPaths: ['flags', 'items[]'] });
  });

  it('closes a pre-built text.format the same way', () => {
    const { body } = buildGatewayRequest('openai/gpt-4.1-mini', user, {
      text: {
        format: {
          type: 'json_schema',
          name: 'x',
          strict: true,
          schema: { type: 'object', properties: { a: { type: 'string' } } },
        },
      },
    });
    const format = (body.text as { format: Record<string, unknown> }).format;
    expect(format.strict).toBe(true);
    expect((format.schema as Record<string, unknown>).additionalProperties).toBe(false);
    expect((format.schema as Record<string, unknown>).required).toEqual(['a']);
  });
});
