import { describe, expect, it } from 'vitest';
import { GLYPH, glyphOf } from './glyphs.ts';
import { categoryOf } from './category.ts';

describe('glyphOf', () => {
  it('breath outranks the word "practice" — the box-breathing musical note (2026-08-31)', () => {
    const g = glyphOf('Box breathing practice');
    expect(g.d).toBe(GLYPH.wind);
    expect(g.cat).toBe('mindset');
  });

  it('a journal is a pen, not a moon; a pure nighttime routine keeps the moon', () => {
    expect(glyphOf('Evening reflection journal').d).toBe(GLYPH.pen);
    expect(glyphOf('Wind-down routine').d).toBe(GLYPH.moon);
  });

  it('each movement kind gets its own object — no more one glyph for every workout', () => {
    expect(glyphOf('Morning joint mobility').d).toBe(GLYPH.axis);
    expect(glyphOf('Obstacle strength').d).toBe(GLYPH.dumbbell);
    expect(glyphOf('Hill intervals').d).toBe(GLYPH.mountain);
    expect(glyphOf('Easy cross-train').d).toBe(GLYPH.bike);
    expect(glyphOf('Easy run').d).toBe(GLYPH.route);
  });

  it('the goal area stays authoritative for the FAMILY while the title picks the glyph', () => {
    // A breathing drill filed under a movement goal: wind glyph, movement colors.
    const g = glyphOf('Breathing ladder', 'movement');
    expect(g.d).toBe(GLYPH.wind);
    expect(g.cat).toBe('movement');
  });

  it('weigh-ins, check-ins, meals and studies each read as what they are', () => {
    expect(glyphOf('Weekly weigh-in').d).toBe(GLYPH.gauge);
    expect(glyphOf('Weekly check-in').d).toBe(GLYPH.bubble);
    expect(glyphOf('Log breakfast').d).toBe(GLYPH.bowl);
    expect(glyphOf('Spanish study').d).toBe(GLYPH.book);
    expect(glyphOf('Piano practice').d).toBe(GLYPH.note);
  });
});

describe('categoryOf ordering', () => {
  it('mind-words beat the practice regex; morning still does not beat mobility', () => {
    expect(categoryOf('Box breathing practice')).toBe('mindset');
    expect(categoryOf('Morning joint mobility')).toBe('movement');
    expect(categoryOf('Piano practice')).toBe('practice');
  });
});
