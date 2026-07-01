import { describe, it, expect } from 'vitest';
import { normalizeToolsForV2 } from '../src/integrations/devs-ai-v2/request-builder.ts';

describe('normalizeToolsForV2', () => {
  it('flattens Chat Completions function tool shape for Responses API', () => {
    const result = normalizeToolsForV2([
      {
        type: 'function',
        function: {
          name: 'echo_ping',
          description: 'Echo input',
          parameters: { type: 'object', properties: { input: { type: 'string' } } },
        },
      },
    ]);
    expect(result[0]).toEqual({
      type: 'function',
      name: 'echo_ping',
      description: 'Echo input',
      parameters: { type: 'object', properties: { input: { type: 'string' } } },
    });
  });
});
