/**
 * The questionnaire card, from the chat side.
 *
 * Same contract as RepertoireOfferCard next door: `send_questionnaire` writes a POINTER, never a
 * tag, so this asks the SERVER what is up and draws nothing when the answer is nothing — which is
 * what makes it safe to mount beside every finished turn.
 *
 * The three that carry the feature: each kind gets the control it needs, Send stays dead until
 * every question has an answer, and what Send hands up is ONE message in the person's own words.
 * The rest are the ways it must not go wrong — a card put aside must not reappear, and a sent card
 * must not offer itself for editing a second time.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getQuestionnaire: vi.fn(),
  clearQuestionnaire: vi.fn(async () => true),
}));
vi.mock('../../lib/api/questionnaire.ts', () => api);

const { QuestionnaireCard } = await import('./QuestionnaireCard.tsx');

const PENDING = {
  questions: [
    { id: 'days_free', label: 'Which days are usually free?', kind: 'multi' as const, options: ['Mon', 'Wed', 'Sat'] },
    { id: 'where', label: 'Where will you be training?', kind: 'choice' as const, options: ['Home', 'Gym'] },
    { id: 'session_length', label: 'How long can a session be?', kind: 'number' as const, hint: 'in minutes' },
    { id: 'anything_else', label: 'Anything I should know?', kind: 'text' as const },
  ],
  sent_at: '2026-09-03T18:00:00.000Z',
};

const send = () => screen.getByRole('button', { name: 'Send' });

/** Fill the card in the order someone would: two days, a place, a number, a sentence. */
function answerEverything() {
  fireEvent.click(screen.getByRole('button', { name: /^Mon/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Sat/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Gym/ }));
  const fields = screen.getAllByRole('spinbutton').concat(screen.getAllByRole('textbox'));
  fireEvent.change(fields[0]!, { target: { value: '45' } });
  fireEvent.change(fields[1]!, { target: { value: 'knee is still sore' } });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.getQuestionnaire.mockResolvedValue(PENDING);
  api.clearQuestionnaire.mockResolvedValue(true);
});

describe('nothing up', () => {
  it('draws nothing at all, so mounting it on every finished turn is safe', async () => {
    api.getQuestionnaire.mockResolvedValueOnce(null);
    const { container } = render(<QuestionnaireCard />);
    await waitFor(() => expect(api.getQuestionnaire).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');
  });

  it('draws nothing when the read broke — a missing card is not a broken turn', async () => {
    api.getQuestionnaire.mockRejectedValueOnce(new Error('down'));
    const { container } = render(<QuestionnaireCard />);
    await waitFor(() => expect(api.getQuestionnaire).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');
  });
});

describe('the controls each kind gets', () => {
  it('draws a button per option for choice and multi, and a field for text and number', async () => {
    render(<QuestionnaireCard />);
    await screen.findByText('Which days are usually free?');

    for (const option of ['Mon', 'Wed', 'Sat', 'Home', 'Gym']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${option}`) })).toBeTruthy();
    }
    // A number question gets a number field (spinbutton), a text question a plain one.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText('in minutes')).toBeTruthy();
  });

  it('lets a multi hold several answers and a choice hold only one', async () => {
    render(<QuestionnaireCard />);
    await screen.findByText('Which days are usually free?');

    fireEvent.click(screen.getByRole('button', { name: /^Mon/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Sat/ }));
    expect(screen.getByRole('button', { name: /^Mon/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Sat/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /^Home/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Gym/ }));
    expect(screen.getByRole('button', { name: /^Home/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /^Gym/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('lets a tap be taken back — an answer being drafted is not a commitment', async () => {
    render(<QuestionnaireCard />);
    await screen.findByText('Which days are usually free?');

    fireEvent.click(screen.getByRole('button', { name: /^Gym/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Gym/ }));
    expect(screen.getByRole('button', { name: /^Gym/ }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('Send', () => {
  it('stays dead until every question has an answer', async () => {
    render(<QuestionnaireCard />);
    await screen.findByText('Which days are usually free?');

    expect((send() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Mon/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Gym/ }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '45' } });
    expect((send() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no' } });
    expect((send() as HTMLButtonElement).disabled).toBe(false);
  });

  it('hands up ONE message in their own words, one line per question', async () => {
    const onSend = vi.fn();
    render(<QuestionnaireCard onSend={onSend} />);
    await screen.findByText('Which days are usually free?');
    answerEverything();

    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toBe(
      [
        'Which days are usually free?: Mon, Sat',
        'Where will you be training?: Gym',
        'How long can a session be?: 45',
        'Anything I should know?: knee is still sore',
      ].join('\n'),
    );
  });

  it('collapses to a receipt and clears the card server-side', async () => {
    render(<QuestionnaireCard onSend={vi.fn()} />);
    await screen.findByText('Which days are usually free?');
    answerEverything();
    fireEvent.click(send());

    expect(screen.queryByText('Which days are usually free?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.getByText('4 answers sent')).toBeTruthy();
    await waitFor(() => expect(api.clearQuestionnaire).toHaveBeenCalledTimes(1));
  });

  it('still collapses when clearing fails — the person did send it', async () => {
    api.clearQuestionnaire.mockRejectedValueOnce(new Error('down'));
    render(<QuestionnaireCard onSend={vi.fn()} />);
    await screen.findByText('Which days are usually free?');
    answerEverything();
    fireEvent.click(send());

    expect(screen.getByText('4 answers sent')).toBeTruthy();
  });
});

describe('Not now', () => {
  it('puts the card away and clears it, so it does not come back next turn', async () => {
    const onSend = vi.fn();
    const { container } = render(<QuestionnaireCard onSend={onSend} />);
    await screen.findByText('Which days are usually free?');

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(container.textContent).toBe('');
    expect(onSend).not.toHaveBeenCalled();
    await waitFor(() => expect(api.clearQuestionnaire).toHaveBeenCalledTimes(1));
  });
});
