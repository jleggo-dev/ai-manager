/**
 * Recap E/F — "Save this as one of yours". Recap itself only ever holds the flat, ALREADY-DERIVED
 * `WalkthroughStep[]` a walkthrough played (see Recap.tsx's own props) — never the coach's original
 * `OccurrenceSession` — so this file's job is reversing that ONE real projection
 * (`deriveWalkthrough`, NOT mocked here on purpose) back into blocks/items. These tests build a
 * realistic `OccurrenceSession`, derive it for real, feed the resulting steps in, and pin the exact
 * `createUserRoutine` payload that comes back out — the press-to-wire bar for the recap save.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { deriveWalkthrough, type OccurrenceSession } from '@cadence/shared';

const createUserRoutine = vi.fn();
vi.mock('../../lib/api.ts', () => ({
  createUserRoutine: (...a: unknown[]) => createUserRoutine(...a),
}));

const { SaveAsYours } = await import('./SaveAsYours.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MIXED_SESSION: OccurrenceSession = {
  blocks: [
    { label: 'Warm-up', items: [{ name: 'Jog', duration_min: 5, tool: 'timer' }] },
    {
      label: 'Main',
      mode: 'circuit',
      rounds: 3,
      items: [
        { name: 'Push-ups', reps: 12 },
        { name: 'Plank', duration_min: 1 },
      ],
    },
    { label: 'Strength', items: [{ name: 'Squat', sets: 3, reps: 8, load: '40 kg', tool: 'reps' }] },
  ],
  note: 'progression note the player never shows back',
  generated_at: '2026-01-01T00:00:00.000Z',
  version: 1,
};

describe('SaveAsYours', () => {
  it('renders nothing when there are no real steps', () => {
    const { container } = render(<SaveAsYours steps={[]} title="Empty" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the quiet line, then a name field pre-filled from the title on tap', () => {
    const steps = deriveWalkthrough(MIXED_SESSION).steps;
    render(<SaveAsYours steps={steps} title="Leg day" />);

    expect(screen.queryByLabelText('Name this activity')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Save this as one of yours'));
    expect(screen.getByLabelText('Name this activity')).toHaveValue('Leg day');
  });

  it('Save calls createUserRoutine with the exact reconstructed session, name and provenance', async () => {
    const steps = deriveWalkthrough(MIXED_SESSION).steps;
    createUserRoutine.mockResolvedValueOnce({ routine_id: 'r1' });
    render(<SaveAsYours steps={steps} title="Leg day" />);

    fireEvent.click(screen.getByText('Save this as one of yours'));
    const input = screen.getByLabelText('Name this activity');
    fireEvent.change(input, { target: { value: 'My leg day' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(createUserRoutine).toHaveBeenCalledTimes(1));
    const payload = createUserRoutine.mock.calls[0]![0];
    expect(payload.name).toBe('My leg day');
    expect(payload.provenance).toEqual({ kind: 'from_recap' });
    // The coach's own progression note never survives — Recap never held it, and nothing here
    // invents one.
    expect(payload.session.note).toBe('');
    expect(payload.session.blocks).toEqual([
      { label: 'Warm-up', items: [{ name: 'Jog', duration_min: 5, tool: 'timer' }] },
      {
        label: 'Main',
        items: [
          { name: 'Push-ups', reps: 12 },
          { name: 'Plank', duration_min: 1 },
        ],
        mode: 'circuit',
        rounds: 3,
      },
      {
        label: 'Strength',
        items: [{ name: 'Squat', duration_min: 3, tool: 'reps', sets: 3, reps: 8, load: '40 kg' }],
      },
    ]);
  });

  it('shows the tiny confirmation on success', async () => {
    const steps = deriveWalkthrough(MIXED_SESSION).steps;
    createUserRoutine.mockResolvedValueOnce({ routine_id: 'r1' });
    render(<SaveAsYours steps={steps} title="Leg day" />);

    fireEvent.click(screen.getByText('Save this as one of yours'));
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText("It's in Your activities.")).toBeInTheDocument();
  });

  it('an honest failure keeps the line usable — the form stays open for a retry', async () => {
    const steps = deriveWalkthrough(MIXED_SESSION).steps;
    createUserRoutine.mockResolvedValueOnce(null);
    render(<SaveAsYours steps={steps} title="Leg day" />);

    fireEvent.click(screen.getByText('Save this as one of yours'));
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText("That didn't go through — try again in a moment.")).toBeInTheDocument();
    const saveBtn = screen.getByText('Save');
    expect(saveBtn).not.toBeDisabled();
  });

  it('Cancel returns to the quiet line without saving anything', () => {
    const steps = deriveWalkthrough(MIXED_SESSION).steps;
    render(<SaveAsYours steps={steps} title="Leg day" />);

    fireEvent.click(screen.getByText('Save this as one of yours'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.getByText('Save this as one of yours')).toBeInTheDocument();
    expect(createUserRoutine).not.toHaveBeenCalled();
  });

  it('reverses a breathing step honestly — the pattern id and cycles, not a re-guess', async () => {
    const session: OccurrenceSession = {
      blocks: [
        {
          label: 'Sit',
          items: [{ name: 'Box breathing', tool: 'breathing', breath_pattern: 'box', breath_cycles: 6 }],
        },
      ],
      note: '',
      generated_at: '',
      version: 1,
    };
    const steps = deriveWalkthrough(session).steps;
    createUserRoutine.mockResolvedValueOnce({ routine_id: 'r1' });
    render(<SaveAsYours steps={steps} title="Sit" />);
    fireEvent.click(screen.getByText('Save this as one of yours'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(createUserRoutine).toHaveBeenCalled());
    const items = createUserRoutine.mock.calls[0]![0].session.blocks[0].items;
    expect(items[0]).toMatchObject({ tool: 'breathing', breath_pattern: 'box', breath_cycles: 6 });
  });

  it('a journal step with a named bank leaves detail unset so the daily phrasing keeps rotating', async () => {
    const session: OccurrenceSession = {
      blocks: [{ label: 'Write', items: [{ name: 'Morning pages', tool: 'journal', journal_bank: 'a_win' }] }],
      note: '',
      generated_at: '',
      version: 1,
    };
    const steps = deriveWalkthrough(session).steps;
    createUserRoutine.mockResolvedValueOnce({ routine_id: 'r1' });
    render(<SaveAsYours steps={steps} title="Write" />);
    fireEvent.click(screen.getByText('Save this as one of yours'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(createUserRoutine).toHaveBeenCalled());
    const item = createUserRoutine.mock.calls[0]![0].session.blocks[0].items[0];
    expect(item.journal_bank).toBe('a_win');
    expect(item.detail).toBeUndefined();
  });

  it('a journal step with no named bank keeps its literal prompt', async () => {
    const session: OccurrenceSession = {
      blocks: [{ label: 'Write', items: [{ name: 'Free-write', tool: 'journal', detail: 'What clicked today?' }] }],
      note: '',
      generated_at: '',
      version: 1,
    };
    const steps = deriveWalkthrough(session).steps;
    createUserRoutine.mockResolvedValueOnce({ routine_id: 'r1' });
    render(<SaveAsYours steps={steps} title="Write" />);
    fireEvent.click(screen.getByText('Save this as one of yours'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(createUserRoutine).toHaveBeenCalled());
    const item = createUserRoutine.mock.calls[0]![0].session.blocks[0].items[0];
    expect(item.detail).toBe('What clicked today?');
    expect(item.journal_bank).toBeUndefined();
  });

  it('reverses a measure step without inventing a tool field measure can never carry', async () => {
    const session: OccurrenceSession = {
      blocks: [{ label: '', items: [{ name: 'Body weight', measure_metric: 'Weight', measure_unit: 'kg' }] }],
      note: '',
      generated_at: '',
      version: 1,
    };
    const steps = deriveWalkthrough(session).steps;
    createUserRoutine.mockResolvedValueOnce({ routine_id: 'r1' });
    render(<SaveAsYours steps={steps} title="Weigh-in" />);
    fireEvent.click(screen.getByText('Save this as one of yours'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(createUserRoutine).toHaveBeenCalled());
    const item = createUserRoutine.mock.calls[0]![0].session.blocks[0].items[0];
    expect(item.measure_metric).toBe('Weight');
    expect(item.measure_unit).toBe('kg');
    expect(item.tool).toBeUndefined();
  });

  it('reverses a distance checkoff back to the same number the label was built from', async () => {
    const session: OccurrenceSession = {
      blocks: [{ label: '', items: [{ name: 'Run', distance_km: 4.8 }] }],
      note: '',
      generated_at: '',
      version: 1,
    };
    const steps = deriveWalkthrough(session).steps;
    createUserRoutine.mockResolvedValueOnce({ routine_id: 'r1' });
    render(<SaveAsYours steps={steps} title="Run" />);
    fireEvent.click(screen.getByText('Save this as one of yours'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(createUserRoutine).toHaveBeenCalled());
    const item = createUserRoutine.mock.calls[0]![0].session.blocks[0].items[0];
    expect(item).toMatchObject({ tool: 'checkoff', distance_km: 4.8 });
  });
});
