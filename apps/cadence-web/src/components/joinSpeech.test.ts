import { joinSpeech } from './joinSpeech.ts';

/** WebKit's transcripts do not reliably bring their own leading space; "helloworld" is the failure. */
describe('joinSpeech', () => {
  it('separates fragments that would otherwise run together', () => {
    expect(joinSpeech('', 'hello', 'world')).toBe('hello world');
    expect(joinSpeech('I said', 'hello', '')).toBe('I said hello');
  });

  it('does not double a space the transcript already brought', () => {
    expect(joinSpeech('', 'hello', ' world')).toBe('hello world');
    expect(joinSpeech('hello ', 'world', '')).toBe('hello world');
  });

  it('keeps existing text at the front and trims only the start', () => {
    expect(joinSpeech('Note: ', 'buy milk', '')).toBe('Note: buy milk');
    expect(joinSpeech('', '', 'partial')).toBe('partial');
    expect(joinSpeech('', '', '')).toBe('');
  });
});
