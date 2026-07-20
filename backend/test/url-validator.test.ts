import { describe, it, expect } from 'vitest';
import { validateSafeUrl } from '../src/lib/url-validator.ts';

describe('url-validator', () => {
  it('blocks private IPs', async () => {
    await expect(validateSafeUrl('http://localhost:3000')).rejects.toThrow();
  });

  it('blocks non-HTTPS by default', async () => {
    await expect(validateSafeUrl('http://example.com')).rejects.toThrow('Only HTTPS');
  });

  it('blocks embedded credentials', async () => {
    await expect(validateSafeUrl('https://user:pass@example.com')).rejects.toThrow('credentials');
  });
});
