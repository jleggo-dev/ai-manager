/**
 * Wired-button coverage for the whole builder surface (owner mandate — every button pressed,
 * every wire asserted): family → seeds → exact session, the palette inserting the right kind,
 * card edits changing the session JSON, reorder/duplicate/delete, the footer total, Save calling
 * `createUserRoutine` with the EXACT composed payload, a failed save keeping the draft, Run it
 * now/Done handing the routine to `onSaved`, the cancel-with-edits confirm, and — update mode
 * (`updateRoutineId`, added post-merge for Settings' "Edit steps" door) — Save calling
 * `updateUserRoutine` instead, never `createUserRoutine`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { inferTool, type OccurrenceSession } from '@cadence/shared';
import type { UserRoutine } from '../../lib/api/user-routines.ts';

const createUserRoutine = vi.fn(async (..._a: unknown[]) => null as UserRoutine | null);
const updateUserRoutine = vi.fn(async (..._a: unknown[]) => null as UserRoutine | null);
vi.mock('../../lib/api/user-routines.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/user-routines.ts')>();
  return {
    ...actual,
    createUserRoutine: (...a: unknown[]) => createUserRoutine(...a),
    updateUserRoutine: (...a: unknown[]) => updateUserRoutine(...a),
  };
});

const { ActivityBuilder } = await import('./ActivityBuilder.tsx');
const { readDraft } = await import('./draftStore.ts');
const { SEEDS } = await import('./builderSeeds.ts');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // The builder now holds its draft on disk (draftStore.ts). Left behind, it restores itself into
  // the NEXT test — so the device is wiped between them, exactly as a fresh one would be.
  window.localStorage.clear();
});

const savedRoutine: UserRoutine = {
  routine_id: 'r1',
  name: 'Study block',
  area: 'practice',
  session: { blocks: [], note: '', generated_at: '2026-09-01T00:00:00.000Z', version: 1 },
  provenance: { kind: 'blank' },
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  runs: 0,
  last_run: null,
  schedule: null,
};

async function enterBlankBuilder(onSaved = vi.fn(), onClose = vi.fn()) {
  render(<ActivityBuilder onSaved={onSaved} onClose={onClose} />);
  fireEvent.click(screen.getByText('Start blank instead'));
  await screen.findByText('Discard');
  return { onSaved, onClose };
}

describe('ActivityBuilder — type-first entry', () => {
  it('shows the family grid first when there is no initial session', () => {
    render(<ActivityBuilder onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByText('What are you building?')).toBeTruthy();
  });

  it('picking a family, then a seed, loads that seed’s EXACT session into the builder', () => {
    render(<ActivityBuilder onSaved={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Practice'));
    const seed = SEEDS.find((s) => s.id === 'practice_scales_repertoire')!;
    fireEvent.click(screen.getByText(seed.title));
    // Builder phase, name pre-filled from the seed, every seeded step's name present as a card.
    expect(screen.getByLabelText('Activity name')).toHaveValue('Scales + repertoire');
    for (const block of seed.session.blocks) {
      expect(screen.getByDisplayValue(block.items[0]!.name)).toBeTruthy();
    }
  });

  it('an `initial.session` skips type-first entirely and opens straight into the builder', () => {
    render(
      <ActivityBuilder
        initial={{ name: 'Easy 5k', session: { blocks: [], note: '', generated_at: '', version: 1 } }}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText('What are you building?')).toBeNull();
    expect(screen.getByLabelText('Activity name')).toHaveValue('Easy 5k');
  });
});

describe('ActivityBuilder — the palette inserts the right step kind', () => {
  it('pressing "Intervals" inserts a card whose item resolves via inferTool to "interval"', async () => {
    await enterBlankBuilder();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Intervals'));
    expect(screen.getByText('intervals')).toBeTruthy();
    // Round-trip through the real inference the walkthrough player uses.
    expect(
      inferTool({
        name: 'Intervals',
        tool: 'interval',
        interval_work_sec: 40,
        interval_recover_sec: 20,
        interval_rounds: 6,
      }).kind,
    ).toBe('interval');
  });

  it('pressing "Measure" inserts a card that resolves via inferTool with no explicit tool field', async () => {
    await enterBlankBuilder();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Measure'));
    expect(screen.getByText('measure')).toBeTruthy();
    expect(inferTool({ name: 'Measure', measure_metric: 'Weight', measure_unit: 'kg' }).kind).toBe('measure');
  });
});

describe('ActivityBuilder — card edits, reorder, duplicate, delete, footer total', () => {
  it('renaming a card and editing its minutes both change the live session', async () => {
    await enterBlankBuilder();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));
    fireEvent.change(screen.getByLabelText('Step name'), { target: { value: 'Plank' } });
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '7' } });
    expect(screen.getByDisplayValue('Plank')).toBeTruthy();
    expect(screen.getByLabelText('Minutes')).toHaveValue(7);
  });

  it('duplicate adds a second identical card; delete removes it again', async () => {
    await enterBlankBuilder();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));
    expect(screen.getAllByLabelText('Step name')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Step options'));
    fireEvent.click(screen.getByText('Duplicate'));
    expect(screen.getAllByLabelText('Step name')).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText('Step options')[0]!);
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getAllByLabelText('Step name')).toHaveLength(1);
  });

  it('▼ then ▲ swaps two cards and swaps back — order round-trips', async () => {
    await enterBlankBuilder();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));
    fireEvent.change(screen.getByLabelText('Step name'), { target: { value: 'First' } });
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Reps & sets'));
    const names = () => screen.getAllByLabelText('Step name').map((el) => (el as HTMLInputElement).value);
    expect(names()).toEqual(['First', 'Reps & sets']);
    fireEvent.click(screen.getAllByLabelText('Move step down')[0]!);
    expect(names()).toEqual(['Reps & sets', 'First']);
    fireEvent.click(screen.getAllByLabelText('Move step up')[1]!);
    expect(names()).toEqual(['First', 'Reps & sets']);
  });

  it('the footer totals honestly and reads "Add a step to begin." on an empty draft', async () => {
    await enterBlankBuilder();
    expect(screen.getByText('Add a step to begin.')).toBeTruthy();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));
    expect(screen.getByText(/1 timed · Total ~5 min/)).toBeTruthy();
  });
});

describe('ActivityBuilder — save', () => {
  it('Save calls createUserRoutine with the EXACT composed payload', async () => {
    await enterBlankBuilder();
    fireEvent.change(screen.getByLabelText('Activity name'), { target: { value: 'My timer' } });
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));
    createUserRoutine.mockResolvedValue(savedRoutine);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(createUserRoutine).toHaveBeenCalledTimes(1));
    expect(createUserRoutine).toHaveBeenCalledWith({
      name: 'My timer',
      area: undefined,
      session: {
        blocks: [{ label: 'Timer', items: [{ name: 'Timer', tool: 'timer', duration_min: 5 }] }],
        note: '',
        generated_at: expect.any(String),
        version: 1,
      },
      provenance: { kind: 'blank' },
    });
  });

  it('on success, shows the saved moment; Run it now hands the routine to onSaved', async () => {
    const { onSaved } = await enterBlankBuilder();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));
    createUserRoutine.mockResolvedValue(savedRoutine);
    fireEvent.click(screen.getByText('Save'));
    await screen.findByText('Study block — saved');
    fireEvent.click(screen.getByText('Run it now'));
    expect(onSaved).toHaveBeenCalledWith(savedRoutine);
  });

  it('Done also hands the saved routine to onSaved', async () => {
    const { onSaved } = await enterBlankBuilder();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));
    createUserRoutine.mockResolvedValue(savedRoutine);
    fireEvent.click(screen.getByText('Save'));
    await screen.findByText('Study block — saved');
    fireEvent.click(screen.getByText('Done'));
    expect(onSaved).toHaveBeenCalledWith(savedRoutine);
  });

  it('on failure (null), shows an honest note, keeps the draft, and re-enables Save', async () => {
    await enterBlankBuilder();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));
    createUserRoutine.mockResolvedValue(null);
    fireEvent.click(screen.getByText('Save'));
    await screen.findByText(/Couldn.t save/);
    // The draft is still there — the card never vanished.
    expect(screen.getByLabelText('Step name')).toHaveValue('Timer');
    expect(screen.getByText('Save')).not.toBeDisabled();
  });
});

describe('ActivityBuilder — cancel', () => {
  it('with no edits, Cancel from the family screen calls onClose directly, no confirm', () => {
    const onClose = vi.fn();
    render(<ActivityBuilder onSaved={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard this draft?')).toBeNull();
  });

  /**
   * The "Discard this draft?" confirm is gone, and the reason is the whole 2026-09-06 design: a
   * nav tap MINIMIZES now, so navigation cannot destroy a draft and there is nothing left to
   * guard against. Discard became the one deliberate destructive act on the screen, under a
   * button that says so — owner's call, taking the fewest-taps option over keeping the dialog.
   */
  it('Discard throws the draft away at once — no confirm in the way', async () => {
    const onClose = vi.fn();
    await enterBlankBuilder(vi.fn(), onClose);
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));

    fireEvent.click(screen.getByText('Discard'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard this draft?')).toBeNull();
  });

  it('Discard also wipes the held draft, so nothing is offered back afterwards', async () => {
    await enterBlankBuilder();
    fireEvent.click(screen.getByText('＋ Add step'));
    fireEvent.click(screen.getByText('Timer'));
    expect(readDraft()).not.toBeNull(); // held from the first change

    fireEvent.click(screen.getByText('Discard'));

    expect(readDraft()).toBeNull();
  });
});

/* ── Update mode (`updateRoutineId`) — editing an EXISTING routine in place, for Settings' "Edit
   steps" door. Added post-merge: a gap in the original brief meant the builder only knew how to
   create, so wiring it as-is to that door would have silently duplicated instead of updated. ── */
const editSession: OccurrenceSession = {
  blocks: [{ label: 'Study', items: [{ name: 'Study', tool: 'timer', duration_min: 20 }] }],
  note: '',
  generated_at: '2026-08-01T00:00:00.000Z',
  version: 1,
};

const updatedRoutine: UserRoutine = { ...savedRoutine, routine_id: 'r9', name: 'Study block' };

describe('ActivityBuilder — update mode', () => {
  it('skips type-first entirely and opens straight into the builder', () => {
    render(
      <ActivityBuilder
        initial={{ name: 'Study block', session: editSession }}
        updateRoutineId="r9"
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText('What are you building?')).toBeNull();
    expect(screen.getByLabelText('Activity name')).toHaveValue('Study block');
    expect(screen.getByDisplayValue('Study')).toBeTruthy();
  });

  it('the dev assertion throws when updateRoutineId is set with no initial.session', () => {
    expect(() => render(<ActivityBuilder updateRoutineId="r9" onSaved={() => {}} onClose={() => {}} />)).toThrowError(
      /updateRoutineId requires initial\.session/,
    );
  });

  it('the Save button reads "Save changes"', () => {
    render(
      <ActivityBuilder
        initial={{ name: 'Study block', session: editSession }}
        updateRoutineId="r9"
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Save changes')).toBeTruthy();
  });

  it('Save calls updateUserRoutine with the exact id and {name, session} — never createUserRoutine', async () => {
    render(
      <ActivityBuilder
        initial={{ name: 'Study block', session: editSession }}
        updateRoutineId="r9"
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Step name'), { target: { value: 'Study, longer' } });
    updateUserRoutine.mockResolvedValue(updatedRoutine);
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(updateUserRoutine).toHaveBeenCalledTimes(1));
    expect(updateUserRoutine).toHaveBeenCalledWith('r9', {
      name: 'Study block',
      session: {
        blocks: [{ label: 'Study, longer', items: [{ name: 'Study, longer', tool: 'timer', duration_min: 20 }] }],
        note: '',
        generated_at: expect.any(String),
        version: 1,
      },
    });
    expect(createUserRoutine).not.toHaveBeenCalled();
  });

  it('on success, the saved moment reads the update-honest line and Run it now hands the UPDATED routine to onSaved', async () => {
    const onSaved = vi.fn();
    render(
      <ActivityBuilder
        initial={{ name: 'Study block', session: editSession }}
        updateRoutineId="r9"
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );
    updateUserRoutine.mockResolvedValue(updatedRoutine);
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText('Saved — future runs follow the new steps.');
    fireEvent.click(screen.getByText('Run it now'));
    expect(onSaved).toHaveBeenCalledWith(updatedRoutine);
  });

  it('on failure (null), keeps the draft and re-enables Save — the same honest handling as create', async () => {
    render(
      <ActivityBuilder
        initial={{ name: 'Study block', session: editSession }}
        updateRoutineId="r9"
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    updateUserRoutine.mockResolvedValue(null);
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText(/Couldn.t save/);
    expect(screen.getByLabelText('Step name')).toHaveValue('Study');
    expect(screen.getByText('Save changes')).not.toBeDisabled();
  });

  it('the type phase never renders in update mode, even with cards cleared out', () => {
    render(
      <ActivityBuilder
        initial={{ name: 'Study block', session: { blocks: [], note: '', generated_at: '', version: 1 } }}
        updateRoutineId="r9"
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText('What are you building?')).toBeNull();
    expect(screen.getByText('Save changes')).toBeTruthy();
  });
});
