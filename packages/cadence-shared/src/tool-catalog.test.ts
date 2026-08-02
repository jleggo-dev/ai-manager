import { describe, it, expect } from 'vitest';
import type { SessionItemTool } from './types/occurrence.ts';
import { inferTool } from './walkthrough.ts';
import {
  COACH_TOOLS,
  SESSION_TOOL_KINDS,
  BLOCK_MODE_KINDS,
  SET_FLOWS,
  renderCoachToolCatalog,
} from './tool-catalog.ts';

/** The catalog is the single source of truth — these lock the two things that must never silently
 *  drift: it covers exactly the coach's tool palette, and its render names every tool + set flow. */
describe('tool catalog', () => {
  const ALL_TOOLS: SessionItemTool[] = [
    'read',
    'timer',
    'reps',
    'checkoff',
    'photo',
    'journal',
    'breathing',
    'meditate',
  ];

  it('covers exactly the SessionItemTool palette (the api whitelist derives from this)', () => {
    expect([...SESSION_TOOL_KINDS].sort()).toEqual([...ALL_TOOLS].sort());
  });

  it('every entry names the fields it reads and gives a self-consistent example', () => {
    for (const kind of SESSION_TOOL_KINDS) {
      const spec = COACH_TOOLS[kind];
      expect(spec.reads.length, `${kind} declares fields`).toBeGreaterThan(0);
      // The example must actually tag itself as this tool, so the coach pattern-matches correctly.
      expect(spec.example.tool, `${kind} example is tagged ${kind}`).toBe(kind);
    }
  });

  it('every tool example survives inference as the tool it claims (the coach→client contract)', () => {
    for (const kind of SESSION_TOOL_KINDS) {
      const item = COACH_TOOLS[kind].example as { name: string; tool: SessionItemTool };
      expect(inferTool(item).kind, `${kind} example round-trips`).toBe(kind);
    }
  });

  it('exposes both set flows', () => {
    expect([...BLOCK_MODE_KINDS].sort()).toEqual(['circuit', 'straight']);
    expect(SET_FLOWS.straight.summary).toMatch(/default/i);
    expect(SET_FLOWS.circuit.summary).toMatch(/rounds/i);
  });

  it('renders a hierarchical block that names every tool and the SET FLOW section', () => {
    const rendered = renderCoachToolCatalog();
    for (const kind of SESSION_TOOL_KINDS) expect(rendered).toContain(`• ${kind} —`);
    expect(rendered).toContain('GUIDED');
    expect(rendered).toContain('CAPTURE');
    expect(rendered).toContain('SET FLOW');
    for (const mode of BLOCK_MODE_KINDS) expect(rendered).toContain(`• ${mode} —`);
    // The timer trap (duration ≠ timer) must survive into the render — it's the judgment the coach needs.
    expect(rendered).toMatch(/do NOT pick timer just because/);
  });
});
