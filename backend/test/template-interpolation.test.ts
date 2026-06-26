import { describe, it, expect } from 'vitest';

function interpolateTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.-]+)\}\}/g, (match: string, key: string): string => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

describe('interpolateTemplate', () => {
  it('replaces {{name}} with value', () => {
    expect(interpolateTemplate('Hello {{name}}!', { name: 'Alice' }))
      .toBe('Hello Alice!');
  });

  it('replaces multiple placeholders', () => {
    const result = interpolateTemplate('{{greeting}}, {{name}}!', {
      greeting: 'Hi',
      name: 'Bob',
    });
    expect(result).toBe('Hi, Bob!');
  });

  it('leaves unknown placeholders unchanged', () => {
    expect(interpolateTemplate('Hello {{unknown}}!', { name: 'Alice' }))
      .toBe('Hello {{unknown}}!');
  });

  it('handles dot-notation keys like {{user.name}}', () => {
    expect(interpolateTemplate('Hello {{user.name}}!', { 'user.name': 'Carol' }))
      .toBe('Hello Carol!');
  });

  it('handles hyphenated keys like {{company-name}}', () => {
    expect(interpolateTemplate('Welcome to {{company-name}}', { 'company-name': 'Acme' }))
      .toBe('Welcome to Acme');
  });

  it('handles numeric values (converts to string)', () => {
    expect(interpolateTemplate('Count: {{count}}', { count: 42 }))
      .toBe('Count: 42');
  });

  it('handles boolean values', () => {
    expect(interpolateTemplate('Active: {{active}}', { active: true }))
      .toBe('Active: true');
    expect(interpolateTemplate('Active: {{active}}', { active: false }))
      .toBe('Active: false');
  });

  it('handles empty string value', () => {
    expect(interpolateTemplate('Value: [{{val}}]', { val: '' }))
      .toBe('Value: []');
  });

  it('returns template unchanged when no placeholders', () => {
    expect(interpolateTemplate('No placeholders here', { name: 'Alice' }))
      .toBe('No placeholders here');
  });

  it('handles undefined explicitly (leaves placeholder)', () => {
    expect(interpolateTemplate('Hello {{name}}!', { name: undefined }))
      .toBe('Hello {{name}}!');
  });
});
