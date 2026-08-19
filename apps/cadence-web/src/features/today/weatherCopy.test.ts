/**
 * The night glyph is a real bug, reported from the frame: `wxEmoji` keyed off the condition word
 * alone, so a clear sky at nine in the evening rendered a sun over a navy trail. The terse line is
 * the evening's other rule — with the quiet chip up, the adjective yields so the row fits.
 */
import { cap, weatherSentence, wxEmoji, wxLine } from './weatherCopy.ts';

describe('wxEmoji', () => {
  it('shows the moon for a clear sky after dark, and the sun before it', () => {
    expect(wxEmoji('Clear', true)).toBe('🌙');
    expect(wxEmoji('clear sky', true)).toBe('🌙');
    expect(wxEmoji('Clear', false)).toBe('☀️');
    expect(wxEmoji('Clear')).toBe('☀️'); // day is the default, as before
  });

  it('leaves weather that reads the same after dark alone', () => {
    expect(wxEmoji('light rain', true)).toBe('🌧️');
    expect(wxEmoji('thunderstorm', true)).toBe('⛈️');
    expect(wxEmoji('snow', true)).toBe('❄️');
    expect(wxEmoji('mostly cloudy', true)).toBe('☁️');
  });

  it('falls back to the sky rather than to a sun it cannot see', () => {
    expect(wxEmoji('breezy', false)).toBe('🌤️');
    expect(wxEmoji('breezy', true)).toBe('🌙');
  });
});

describe('wxLine', () => {
  it('names the condition when there is room for it', () => {
    expect(wxLine('mostly cloudy', 26, false)).toBe('Mostly cloudy · 26°');
  });

  it('drops the condition word while the quiet chip is up', () => {
    expect(wxLine('clear', 19, true)).toBe('19°');
  });

  it('never renders a lonely separator', () => {
    expect(wxLine(undefined, 19, false)).toBe('19°');
    expect(wxLine('clear', undefined, false)).toBe('Clear');
    expect(wxLine('clear', undefined, true)).toBe('Clear');
  });
});

describe('weatherSentence', () => {
  it('is composed from the reading, never invented', () => {
    expect(weatherSentence({ conditions: 'clear', temp_c: 19, precip_chance: 0.4 })).toBe(
      'Clear and 19° right now — about a 40% chance of rain later on.',
    );
    expect(weatherSentence({ conditions: 'clear', temp_c: -3, precip_chance: 0.6 })).toBe(
      'Clear and -3° right now — about a 60% chance of snow later on.',
    );
  });

  it('stops after the reading when there is no probability to quote', () => {
    expect(weatherSentence({ conditions: 'clear', temp_c: 19 })).toBe('Clear and 19° right now.');
    expect(weatherSentence({ conditions: 'clear', temp_c: 19, precip_chance: null })).toBe('Clear and 19° right now.');
  });

  it('says dry rather than quoting a number nobody needs', () => {
    expect(weatherSentence({ conditions: 'clear', temp_c: 19, precip_chance: 0.05 })).toBe(
      'Clear and 19° right now — dry for the next few hours.',
    );
  });
});

describe('cap', () => {
  it('leaves an empty string alone', () => {
    expect(cap('')).toBe('');
  });
});
