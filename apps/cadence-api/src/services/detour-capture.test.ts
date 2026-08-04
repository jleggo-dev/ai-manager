import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The conversational door's failure modes are all "acted without consent" or "trusted the model".
 * These tests pin every gate: no signal → no job; active episode → no job; anything short of an
 * explicit confirmed yes → nothing entered; junk from the model → clamped or dropped.
 *
 * Mock wall (the CI lesson): aim.ts and the repos reach config.ts at module scope, which throws
 * without CADENCE_* secrets — invisible locally, fatal in CI. Everything stateful is mocked.
 */
const runJobBySlug = vi.fn();
const getActiveEpisode = vi.fn();
const enterEpisode = vi.fn();
vi.mock('../ai/aim.ts', () => ({ runJobBySlug: (...a: unknown[]) => runJobBySlug(...a) }));
vi.mock('../repos/episodes.ts', () => ({ getActiveEpisode: (...a: unknown[]) => getActiveEpisode(...a) }));
const reviseEpisodeEquipment = vi.fn();
vi.mock('./episode.ts', () => ({
  enterEpisode: (...a: unknown[]) => enterEpisode(...a),
  reviseEpisodeEquipment: (...a: unknown[]) => reviseEpisodeEquipment(...a),
}));

const { runDetourCapture, normalizeDetour, normalizeEquipmentUpdate } = await import('./detour-capture.ts');
const { hasDetourSignal, hasEquipmentSignal } = await import('./detour-signal.ts');

const CONFIRMED = JSON.stringify({
  detour: {
    type: 'travel',
    days: 5,
    end: null,
    available_equipment: [{ name: 'Hotel gym' }, { name: 'Resistance band' }],
    confirmed: true,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  getActiveEpisode.mockResolvedValue(null);
  enterEpisode.mockResolvedValue({ episode: { type: 'travel' }, note: '' });
});

describe('the deterministic gate', () => {
  it('a conversation with no disruption in it never calls the LLM', async () => {
    const out = await runDetourCapture('u1', 'User: how many reps was that again?\nCoach: Twelve.');
    expect(out).toEqual({ ran: false, entered: false, reason: 'no_signal' });
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('fires on the coach half of the exchange, not only the user half', () => {
    expect(hasDetourSignal('Coach: want me to set up a detour for those days?')).toBe(true);
    expect(hasDetourSignal('User: my knee injury is back')).toBe(true);
    expect(hasDetourSignal('User: what should i eat before a run')).toBe(false);
  });

  it('an active episode flips to update mode — entering is off the table', async () => {
    getActiveEpisode.mockResolvedValue({ type: 'travel', start: '2026-08-04', end: '2026-08-09' });
    // Arrangement talk with no equipment in it: quiet, no job.
    const out = await runDetourCapture('u1', 'User: about that trip — yes, set it up');
    expect(out.reason).toBe('no_signal');
    expect(runJobBySlug).not.toHaveBeenCalled();
    expect(enterEpisode).not.toHaveBeenCalled();
  });
});

describe('consent is the only trigger', () => {
  it('a confirmed agreement enters the episode with the window and the gear', async () => {
    runJobBySlug.mockResolvedValue({ formatted: CONFIRMED });
    const out = await runDetourCapture('u1', 'User: flying tuesday… Coach: …detour? User: yes');
    expect(out).toEqual({ ran: true, entered: true, reason: 'entered' });
    expect(enterEpisode).toHaveBeenCalledWith('u1', {
      type: 'travel',
      days: 5,
      end: undefined,
      available_equipment: [{ name: 'Hotel gym' }, { name: 'Resistance band' }],
    });
  });

  it('a mere mention of a trip enters nothing', async () => {
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ detour: null }) });
    const out = await runDetourCapture('u1', 'User: got a trip coming up next month, kinda dreading it');
    expect(out).toEqual({ ran: true, entered: false, reason: 'no_agreement' });
    expect(enterEpisode).not.toHaveBeenCalled();
  });

  it('confirmed:false is not consent, whatever else the model filled in', () => {
    const raw = JSON.stringify({ detour: { type: 'travel', days: 5, available_equipment: [], confirmed: false } });
    expect(normalizeDetour(raw)).toBeNull();
  });

  it('a missing confirmed field is not consent either', () => {
    const raw = JSON.stringify({ detour: { type: 'travel', days: 5, available_equipment: [] } });
    expect(normalizeDetour(raw)).toBeNull();
  });
});

describe('nothing from the model is trusted', () => {
  it('an invented episode type is dropped whole', () => {
    const raw = JSON.stringify({ detour: { type: 'sabbatical', confirmed: true, available_equipment: [] } });
    expect(normalizeDetour(raw)).toBeNull();
  });

  it('absurd days clamp; a malformed end date is discarded', () => {
    const raw = JSON.stringify({
      detour: { type: 'travel', days: 900, end: 'next tuesday', confirmed: true, available_equipment: [] },
    });
    expect(normalizeDetour(raw)).toEqual({ type: 'travel', days: 60, end: undefined, available_equipment: [] });
  });

  it('equipment is capped, trimmed, and junk entries are dropped', () => {
    const gear = Array.from({ length: 30 }, (_, i) => ({ name: `  item ${i}  ` }));
    const raw = JSON.stringify({
      detour: {
        type: 'travel',
        confirmed: true,
        available_equipment: [...gear, { name: '' }, { nope: true }, null],
      },
    });
    const out = normalizeDetour(raw);
    expect(out?.available_equipment).toHaveLength(20);
    expect(out?.available_equipment[0]).toEqual({ name: 'item 0' });
  });

  it('unparseable output enters nothing', () => {
    expect(normalizeDetour('I would say the user seems to be travelling!')).toBeNull();
  });

  it('no active plan → ran but not entered, reported honestly', async () => {
    runJobBySlug.mockResolvedValue({ formatted: CONFIRMED });
    enterEpisode.mockResolvedValue(null);
    const out = await runDetourCapture('u1', 'User: trip… Coach: detour? User: yes');
    expect(out).toEqual({ ran: true, entered: false, reason: 'no_plan' });
  });
});

describe('update mode — the equipment answer arrives mid-window', () => {
  const ACTIVE = { type: 'travel', start: '2026-08-04', end: '2026-08-09', available_equipment: [] };

  it('revises the remaining days when the user reports the gym', async () => {
    getActiveEpisode.mockResolvedValue(ACTIVE);
    reviseEpisodeEquipment.mockResolvedValue({ revised: true, reason: 'revised' });
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({ detour: null, equipment_update: [{ name: 'dumbbells' }, { name: 'rower' }] }),
    });
    const out = await runDetourCapture('u1', 'User: ok im here, the gym has dumbbells and a rower');
    expect(out.reason).toBe('equipment_revised');
    expect(reviseEpisodeEquipment).toHaveBeenCalledWith('u1', [{ name: 'dumbbells' }, { name: 'rower' }]);
    expect(enterEpisode).not.toHaveBeenCalled();
  });

  it('the job is TOLD about the episode, so it can tell new from repeated', async () => {
    getActiveEpisode.mockResolvedValue(ACTIVE);
    reviseEpisodeEquipment.mockResolvedValue({ revised: true, reason: 'revised' });
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({ detour: null, equipment_update: [{ name: 'bike' }] }),
    });
    await runDetourCapture('u1', 'User: theres an exercise bike here');
    const vars = runJobBySlug.mock.calls[0]?.[2] as { active_episode?: string };
    expect(JSON.parse(vars.active_episode ?? '{}').type).toBe('travel');
  });

  it('"nothing here" is a real answer — an explicit empty list re-drafts to bodyweight', () => {
    expect(normalizeEquipmentUpdate(JSON.stringify({ detour: null, equipment_update: [] }))).toEqual([]);
  });

  it('silence about equipment is null, never an accidental wipe', () => {
    expect(normalizeEquipmentUpdate(JSON.stringify({ detour: null, equipment_update: null }))).toBeNull();
    expect(normalizeEquipmentUpdate(JSON.stringify({ detour: null }))).toBeNull();
  });

  it('same names again reports unchanged — the churn guard downstream', async () => {
    getActiveEpisode.mockResolvedValue({ ...ACTIVE, available_equipment: [{ name: 'dumbbells' }] });
    reviseEpisodeEquipment.mockResolvedValue({ revised: false, reason: 'unchanged' });
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({ detour: null, equipment_update: [{ name: 'dumbbells' }] }),
    });
    const out = await runDetourCapture('u1', 'User: like i said, dumbbells in the gym');
    expect(out.reason).toBe('equipment_unchanged');
  });

  it('gym talk gates in only while an episode is active', () => {
    expect(hasEquipmentSignal('User: the gym here has a bench and weights')).toBe(true);
    expect(hasEquipmentSignal('User: how was your day')).toBe(false);
  });
});

describe('a detour agreed in advance is scheduled, not started', () => {
  it('a stated arrival date passes through to enterEpisode', async () => {
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        detour: { type: 'travel', start: '2026-08-06', end: '2026-08-10', available_equipment: [], confirmed: true },
      }),
    });
    await runDetourCapture('u1', 'User: travelling thursday to monday… Coach: detour? User: yes');
    expect(enterEpisode).toHaveBeenCalledWith('u1', expect.objectContaining({ start: '2026-08-06' }));
  });

  it('a malformed start is dropped — entering begins today, never on garbage', () => {
    const raw = JSON.stringify({
      detour: { type: 'travel', start: 'thursday', confirmed: true, available_equipment: [] },
    });
    expect(normalizeDetour(raw)?.start).toBeUndefined();
  });
});
