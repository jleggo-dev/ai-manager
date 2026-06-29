import { describe, it, expect } from 'vitest';

/** Inline copies of @ai-admin/client / @ai-admin/edge helpers for unit testing without cross-workspace imports. */
function normalizeAiAdminBaseUrl(rawBase: string): string {
  const raw = rawBase.replace(/\/+$/, '');
  if (raw.includes('/_/backend') || raw.includes('localhost')) return raw;
  return `${raw}/_/backend`;
}

function parseSseText(text: string): { content: string; done: boolean } {
  let content = '';
  let done = false;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') {
      done = true;
      break;
    }
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      const delta = parsed.text || parsed.delta || parsed.content || '';
      if (typeof delta === 'string') content += delta;
      if (parsed.type === 'formatted_response' && typeof parsed.content === 'string') {
        content = parsed.content;
      }
    } catch {
      /* ignore */
    }
  }
  return { content, done };
}

describe('@ai-admin/client helpers', () => {
  it('normalizeAiAdminBaseUrl appends /_/backend for Vercel', () => {
    expect(normalizeAiAdminBaseUrl('https://ai-manager-alpha-seven.vercel.app')).toBe(
      'https://ai-manager-alpha-seven.vercel.app/_/backend',
    );
  });

  it('parseSseText extracts content and detects [DONE]', () => {
    const sse = 'data: {"text":"Hello"}\n\ndata: [DONE]\n';
    const parsed = parseSseText(sse);
    expect(parsed.content).toContain('Hello');
    expect(parsed.done).toBe(true);
  });
});
