/**
 * The quick-log "What did you have?" sheet: the same read as the chat door, listed as rows with no
 * tap-to-edit — so its not-reached notice must not promise one — and a row waiting on the coach's
 * question is shown as the question and left out of the button's total.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../../components/MicButton.tsx', () => ({ MicButton: () => <button type="button">mic</button> }));
vi.mock('../../../components/CoachFace.tsx', () => ({ CoachFace: () => <span /> }));
const api = vi.hoisted(() => ({ previewMeal: vi.fn() }));
vi.mock('../../../lib/api.ts', () => api);

const { DescribeSheet } = await import('./DescribeSheet.tsx');
const { NOT_REACHED } = await import('../LogByChat.tsx');

const base = {
  meal: 'snack' as const,
  raw_text: 'a banana',
  items: [{ name: 'Banana, raw', qty: 1, unit: 'medium', est: { kcal: 105 } }],
  macros: { kcal: 105 },
  confidence: null,
  flags: {},
};

async function lookUp(preview: unknown) {
  api.previewMeal.mockResolvedValueOnce(preview);
  render(<DescribeSheet meal="snack" seed="a banana" onAdd={async () => true} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));
  await screen.findByText('Banana, raw');
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DescribeSheet — who read it, and what the rows say', () => {
  it.each([
    [
      'the coach could not be reached → the notice alone, no tap hint (these rows do not open an editor)',
      { ...base, coach: { reached: false, calls: 1, checked: [] } },
      NOT_REACHED,
    ],
    [
      'the coach read it → "Here\'s what I found"',
      { ...base, coach: { reached: true, calls: 1, checked: [] } },
      "Here's what I found",
    ],
    ['no coach block at all → "Here\'s what I found"', base, "Here's what I found"],
  ])('%s', async (_, preview, text) => {
    await lookUp(preview);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/Tap a row/)).not.toBeInTheDocument();
  });

  it('the trace renders only from what ran', async () => {
    await lookUp({ ...base, coach: { reached: true, calls: 1, checked: ['banana: your foods: 1 rows'] } });
    expect(screen.getByText('Checked banana: your foods: 1 rows.')).toBeInTheDocument();
    cleanup();
    await lookUp({ ...base, coach: { reached: true, calls: 1, checked: [] } });
    expect(screen.queryByText(/^Checked/)).not.toBeInTheDocument();
  });

  it('a row waiting on her question shows the question, asks the amount, and is not in the total', async () => {
    await lookUp({
      ...base,
      items: [{ name: 'milk', question: 'Whole milk or 2%?' }, ...base.items],
      coach: { reached: true, calls: 1, checked: [] },
    });
    expect(screen.getByText('Whole milk or 2%?')).toBeInTheDocument();
    expect(screen.getByText('how much?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Looks right · 105 kcal/ })).toBeInTheDocument();
  });
});
