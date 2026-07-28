import { describe, it, expect } from 'vitest';
import { createTimer, start, pause, reset, tick, elapsedFraction, formatClock } from './timer.ts';

describe('createTimer', () => {
  it('rounds + floors the length, starts ready, and a zero-length timer is born done', () => {
    expect(createTimer(90)).toEqual({ total: 90, remaining: 90, status: 'ready' });
    expect(createTimer(59.6)).toEqual({ total: 60, remaining: 60, status: 'ready' });
    expect(createTimer(-5)).toEqual({ total: 0, remaining: 0, status: 'done' });
  });
});

describe('transitions', () => {
  it('start runs a ready timer but never revives a done one', () => {
    expect(start(createTimer(30)).status).toBe('running');
    expect(start(createTimer(0)).status).toBe('done');
  });

  it('tick only moves a running timer and flips to done at zero', () => {
    const running = start(createTimer(2));
    const t1 = tick(running);
    expect(t1).toMatchObject({ remaining: 1, status: 'running' });
    const t2 = tick(t1);
    expect(t2).toMatchObject({ remaining: 0, status: 'done' });
    expect(tick(t2)).toEqual(t2); // done stays put
    expect(tick(createTimer(30))).toEqual(createTimer(30)); // a ready timer doesn't tick
  });

  it('pause halts a running timer and resume continues from where it stopped', () => {
    const paused = pause(tick(start(createTimer(10))));
    expect(paused).toMatchObject({ remaining: 9, status: 'paused' });
    expect(tick(paused)).toEqual(paused); // paused doesn't tick
    expect(start(paused)).toMatchObject({ remaining: 9, status: 'running' });
  });

  it('reset returns a fresh timer of the same length', () => {
    const spent = tick(tick(start(createTimer(5))));
    expect(reset(spent)).toEqual(createTimer(5));
  });
});

describe('formatClock + elapsedFraction', () => {
  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
  });

  it('reports the elapsed fraction', () => {
    expect(elapsedFraction(createTimer(60))).toBe(0);
    expect(elapsedFraction({ total: 60, remaining: 15, status: 'running' })).toBe(0.75);
    expect(elapsedFraction(createTimer(0))).toBe(1);
  });
});
