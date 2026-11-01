/**
 * The in-drawer meal chat's camera (owner, 2026-11-01: photos in every chat). The photo rides the
 * coach tab's own tray into the same `send`, and a photo alone is a message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const chat = vi.hoisted(() => ({
  turns: [] as unknown[],
  input: '',
  setInput: vi.fn(),
  streaming: false,
  restored: true,
  nudge: vi.fn(async () => {}),
  send: vi.fn(async () => {}),
  sendText: vi.fn(async () => true),
}));
vi.mock('../../onboarding/useCoachChat.ts', () => ({ useCoachChat: () => chat }));
vi.mock('../../../components/CoachFace.tsx', () => ({ CoachFace: () => <span /> }));
vi.mock('../../../lib/attachments/prepare.ts', () => ({
  prepareAttachment: async (f: File) => ({
    kind: 'image',
    name: f.name,
    mime: 'image/jpeg',
    blob: f,
    previewUrl: null,
  }),
}));
vi.mock('../../../lib/api/coach-attachments.ts', () => ({
  uploadCoachAttachment: async (p: { name: string }) => ({ ref: `u/${p.name}`, kind: 'image', name: p.name }),
}));

const { MealChatPanel } = await import('./MealChatPanel.tsx');

const panel = () => (
  <MealChatPanel mealTitle="Dinner" chips={[]} kcal={0} state="empty" note="a note" onBack={() => {}} />
);

beforeEach(() => {
  chat.input = '';
  chat.send.mockClear();
});

describe('MealChatPanel — the camera', () => {
  it('Send stays off with nothing to say', () => {
    render(panel());
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('a photo alone lights Send and goes out with the message', async () => {
    render(panel());
    fireEvent.click(screen.getByRole('button', { name: 'Add a photo' }));
    const input = screen.getByRole('menuitem', { name: 'Choose from your photos' }).querySelector('input')!;
    fireEvent.change(input, { target: { files: [new File(['x'], 'plate.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(chat.send).toHaveBeenCalledWith({
      refs: [{ ref: 'u/plate.jpg', kind: 'image', name: 'plate.jpg' }],
      labels: ['plate.jpg'],
    });
  });
});
