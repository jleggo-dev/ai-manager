import { describe, it, expect } from 'vitest';
import { AimError } from './aim-errors.ts';

describe('AimError.classify', () => {
  it('tags auth-context / workspace failures as config', () => {
    expect(AimError.classify(new Error('auth context failed'))).toBe('config');
    expect(AimError.classify(new Error('AIM workspace missing'))).toBe('config');
    expect(AimError.classify(new Error('calling application required'))).toBe('config');
  });

  it('tags not-found shapes', () => {
    expect(AimError.classify(new Error('Processing job not found'))).toBe('not_found');
    expect(AimError.classify(Object.assign(new Error('gone'), { status: 404 }))).toBe('not_found');
    expect(AimError.classify(new Error('missing session for user'))).toBe('not_found');
  });

  it('tags upstream / provider timeouts', () => {
    expect(AimError.classify(new Error('Devs.ai v2 resume error'))).toBe('upstream');
    expect(AimError.classify(new Error('Google Gemini stream timed out'))).toBe('upstream');
    expect(AimError.classify(Object.assign(new Error('boom'), { status: 503 }))).toBe('upstream');
  });

  it('defaults unknown messages to unknown', () => {
    expect(AimError.classify(new Error('something odd'))).toBe('unknown');
    expect(AimError.classify('plain string')).toBe('unknown');
  });

  it('fromUnknown preserves an existing AimError', () => {
    const original = new AimError('upstream', 'already classified');
    expect(AimError.fromUnknown(original)).toBe(original);
  });

  it('httpStatus maps kinds declaratively', () => {
    expect(new AimError('not_found', 'x').httpStatus).toBe(404);
    expect(new AimError('upstream', 'x').httpStatus).toBe(502);
    expect(new AimError('config', 'x').httpStatus).toBe(500);
    expect(new AimError('unknown', 'x').httpStatus).toBe(500);
  });
});
