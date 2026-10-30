/**
 * `createClientForType` is a router: a provider row's `type` string picks the client class, and
 * the wrong pick fails silently (a Devs.ai client would happily POST a gateway key to devs.ai).
 * So it gets a table of positives AND near-misses.
 */
import { describe, it, expect } from 'vitest';
import { createClientForType } from '../src/integrations/client-factory.ts';
import { DevsAiClient } from '../src/integrations/devs-ai/client.ts';
import { DevsAiV2Client } from '../src/integrations/devs-ai-v2/client.ts';
import { GoogleGeminiClient } from '../src/integrations/google-gemini/client.ts';
import { VercelAiGatewayClient } from '../src/integrations/vercel-ai-gateway/client.ts';

describe('createClientForType', () => {
  it.each([
    ['vercel-ai-gateway', VercelAiGatewayClient],
    // trim + lowercase is the existing normalisation, so these resolve on purpose:
    ['Vercel-AI-Gateway', VercelAiGatewayClient],
    ['  vercel-ai-gateway ', VercelAiGatewayClient],
    ['devs-ai-v2', DevsAiV2Client],
    ['DEVS-AI-V2', DevsAiV2Client],
    ['google-gemini', GoogleGeminiClient],
    ['devs-ai', DevsAiClient],
    ['', DevsAiClient],
  ])('%j → %s', (type, cls) => {
    expect(createClientForType(type, 'https://example.test', 'k')).toBeInstanceOf(cls);
  });

  it.each([
    ['vercel'],
    ['vercel-ai'],
    ['ai-gateway'],
    ['vercel_ai_gateway'],
    ['vercel-ai-gateway-v2'],
    ['vercelaigateway'],
    ['gateway'],
  ])('refuses the near-miss %j rather than guessing', (type) => {
    expect(() => createClientForType(type, 'https://example.test', 'k')).toThrow(/Unsupported provider type/);
  });

  it('hands the gateway client the row base URL and key as given', () => {
    const client = createClientForType('vercel-ai-gateway', 'https://ai-gateway.vercel.sh/v1/', 'k1');
    expect(client).toBeInstanceOf(VercelAiGatewayClient);
    expect((client as VercelAiGatewayClient).baseUrl).toBe('https://ai-gateway.vercel.sh/v1');
    expect((client as VercelAiGatewayClient).apiKey).toBe('k1');
  });
});
