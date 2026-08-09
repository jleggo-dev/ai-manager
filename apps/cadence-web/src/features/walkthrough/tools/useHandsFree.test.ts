import { describe, it, expect } from 'vitest';
import { matchCommand, type HandsFreeCommand } from './useHandsFree.ts';

/**
 * The grammar is the whole safety surface of hands-free control: a word that lands on the wrong
 * command mid-workout either throws away a rep or restarts a run someone is four rounds into.
 */
describe('matchCommand', () => {
  it('matches loosely inside a sentence, because nobody speaks in single words mid-set', () => {
    expect(matchCommand('okay, pause')).toBe('pause');
    expect(matchCommand('PAUSE IT')).toBe('pause');
    expect(matchCommand('uh, skip this one')).toBe('skip');
  });

  it('tests "restart" before "start" — the longer word contains the shorter one', () => {
    expect(matchCommand('restart')).toBe('restart');
    expect(matchCommand('start over')).toBe('restart');
    expect(matchCommand('start')).toBe('start');
  });

  it('reads the synonyms people actually shout', () => {
    expect(matchCommand('go')).toBe('start');
    expect(matchCommand('resume')).toBe('start');
    expect(matchCommand('stop')).toBe('pause');
  });

  it('keeps "skip" and "next" apart — they say opposite things about what you did', () => {
    expect(matchCommand('next')).toBe('next');
    expect(matchCommand('done')).toBe('next');
    expect(matchCommand('skip')).toBe('skip');
  });

  it('is silent on anything outside the grammar', () => {
    expect(matchCommand('how much longer')).toBeNull();
    expect(matchCommand('')).toBeNull();
  });

  it('ignores a real command the surface does not accept, rather than firing the nearest one', () => {
    const circuit: HandsFreeCommand[] = ['next'];
    // The whole point of the split: a circuit hearing "skip" must NOT log the move.
    expect(matchCommand('skip', circuit)).toBeNull();
    expect(matchCommand('pause', circuit)).toBeNull();
    expect(matchCommand('next', circuit)).toBe('next');
  });

  it('lets a countdown accept start/pause/restart without advertising skip', () => {
    const timer: HandsFreeCommand[] = ['start', 'pause', 'restart'];
    expect(matchCommand('skip', timer)).toBeNull();
    expect(matchCommand('restart', timer)).toBe('restart');
    expect(matchCommand('go', timer)).toBe('start');
  });
});
