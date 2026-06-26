import { interpolateTemplate, extractPlaceholders, applyInputMappings } from './interpolate';

describe('interpolateTemplate', () => {
  it('replaces single placeholder with matching variable', () => {
    const result = interpolateTemplate('Hello {{name}}!', { name: 'Alice' });
    expect(result.text).toBe('Hello Alice!');
    expect(result.usedKeys).toEqual(['name']);
    expect(result.missingKeys).toEqual([]);
  });

  it('replaces multiple distinct placeholders', () => {
    const result = interpolateTemplate('{{greeting}} {{name}}, welcome to {{place}}.', {
      greeting: 'Hi',
      name: 'Bob',
      place: 'Paris',
    });
    expect(result.text).toBe('Hi Bob, welcome to Paris.');
    expect(result.usedKeys).toEqual(['greeting', 'name', 'place']);
    expect(result.missingKeys).toEqual([]);
  });

  it('reports missing keys when variables are not provided', () => {
    const result = interpolateTemplate('{{a}} and {{b}}', { a: 'yes' });
    expect(result.text).toBe('yes and {{b}}');
    expect(result.usedKeys).toEqual(['a']);
    expect(result.missingKeys).toEqual(['b']);
  });

  it('leaves unmatched placeholders intact', () => {
    const result = interpolateTemplate('{{unknown}} stays', {});
    expect(result.text).toBe('{{unknown}} stays');
    expect(result.missingKeys).toEqual(['unknown']);
  });

  it('handles empty template', () => {
    const result = interpolateTemplate('', { foo: 'bar' });
    expect(result.text).toBe('');
    expect(result.usedKeys).toEqual([]);
    expect(result.missingKeys).toEqual([]);
  });

  it('handles template with no placeholders', () => {
    const result = interpolateTemplate('Plain text.', { foo: 'bar' });
    expect(result.text).toBe('Plain text.');
    expect(result.usedKeys).toEqual([]);
    expect(result.missingKeys).toEqual([]);
  });

  it('handles duplicate placeholder usage', () => {
    const result = interpolateTemplate('{{x}} and {{x}} again', { x: 'hello' });
    expect(result.text).toBe('hello and hello again');
    expect(result.usedKeys).toEqual(['x', 'x']);
  });

  it('handles dot-separated keys', () => {
    const result = interpolateTemplate('Value: {{config.timeout}}', { 'config.timeout': '5000' });
    expect(result.text).toBe('Value: 5000');
    expect(result.usedKeys).toEqual(['config.timeout']);
  });

  it('does not interpolate empty string variable', () => {
    const result = interpolateTemplate('Value: {{key}}', { key: '' });
    expect(result.text).toBe('Value: ');
    expect(result.usedKeys).toEqual(['key']);
  });

  it('handles multiline templates', () => {
    const template = 'Line 1: {{a}}\nLine 2: {{b}}\nLine 3: {{c}}';
    const result = interpolateTemplate(template, { a: 'X', b: 'Y', c: 'Z' });
    expect(result.text).toBe('Line 1: X\nLine 2: Y\nLine 3: Z');
  });
});

describe('extractPlaceholders', () => {
  it('extracts unique keys from template', () => {
    expect(extractPlaceholders('{{a}} and {{b}} and {{a}}')).toEqual(['a', 'b']);
  });

  it('returns empty array for template with no placeholders', () => {
    expect(extractPlaceholders('No placeholders here')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractPlaceholders('')).toEqual([]);
  });

  it('extracts dot-separated keys', () => {
    expect(extractPlaceholders('{{config.timeout}}')).toEqual(['config.timeout']);
  });

  it('extracts multiple distinct keys in order', () => {
    const keys = extractPlaceholders('{{title}}, {{description}}, {{notes}}');
    expect(keys).toEqual(['title', 'description', 'notes']);
  });
});

describe('applyInputMappings', () => {
  it('maps workflow variables to job variables', () => {
    const result = applyInputMappings(
      { current_title: 'wf_title', format: 'wf_format' },
      { wf_title: 'My Title', wf_format: 'Panel' },
      {},
    );
    expect(result).toEqual({ current_title: 'My Title', format: 'Panel' });
  });

  it('caller vars override mapped values', () => {
    const result = applyInputMappings(
      { current_title: 'wf_title' },
      { wf_title: 'Mapped Title' },
      { current_title: 'Override Title' },
    );
    expect(result.current_title).toBe('Override Title');
  });

  it('ignores mappings for unavailable variables', () => {
    const result = applyInputMappings({ current_title: 'wf_title', notes: 'wf_notes' }, { wf_title: 'My Title' }, {});
    expect(result).toEqual({ current_title: 'My Title' });
    expect(result).not.toHaveProperty('notes');
  });

  it('returns caller vars when no mappings exist', () => {
    const result = applyInputMappings({}, {}, { custom: 'value' });
    expect(result).toEqual({ custom: 'value' });
  });

  it('handles empty everything', () => {
    const result = applyInputMappings({}, {}, {});
    expect(result).toEqual({});
  });
});
