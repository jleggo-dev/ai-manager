import { fireEvent, render, screen } from '@testing-library/react';
import { OnboardingChat } from './OnboardingChat.tsx';

vi.mock('../../lib/api.ts', () => ({
  getCurrentCoach: vi.fn().mockResolvedValue({ sessionId: null, messages: [] }),
  getReview: vi.fn().mockResolvedValue({ goals: [] }),
  openCoachSession: vi.fn().mockResolvedValue({ sessionId: 'test-session' }),
  sendCoachMessage: vi.fn().mockResolvedValue({ completed: true, responseId: null }),
  prepareCoachFoodAction: vi.fn().mockResolvedValue({ status: 'ok', action: null }),
}));

// The Web Speech API isn't in jsdom; stub the mic so its empty-field state is deterministic
// without depending on browser feature detection.
vi.mock('../../components/MicButton.tsx', () => ({
  MicButton: () => <button aria-label="Dictate">mic</button>,
}));

describe('OnboardingChat', () => {
  it('renders the coach greeting as plain text (no bubble) alongside the mic in an empty composer', async () => {
    render(<OnboardingChat />);

    const greeting = await screen.findByText(/Tell me what you'd like to work on/);
    expect(greeting.className).toBe('coach-msg');
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('swaps the mic for the send button once text is entered', async () => {
    render(<OnboardingChat />);
    await screen.findByText(/Tell me what you'd like to work on/);

    fireEvent.change(screen.getByPlaceholderText('Message your coach…'), { target: { value: 'Hello' } });

    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument();
  });

  it('shows the floating Review pill and AI disclaimer in onboarding chrome, but not in tab chrome', async () => {
    const { unmount } = render(<OnboardingChat chrome="onboarding" onReview={() => {}} />);
    await screen.findByText(/Tell me what you'd like to work on/);
    expect(screen.getByText(/Review/)).toBeInTheDocument();
    expect(screen.getByText(/double-check what I say/)).toBeInTheDocument();
    unmount();

    render(<OnboardingChat chrome="none" intent="ongoing" />);
    await screen.findByText(/good to see you/);
    expect(screen.queryByText(/Review/)).not.toBeInTheDocument();
    expect(screen.queryByText(/double-check what I say/)).not.toBeInTheDocument();
  });

  it('renders a floating settings gear only when onSettings is provided', async () => {
    const { unmount } = render(<OnboardingChat chrome="none" intent="ongoing" onSettings={() => {}} />);
    await screen.findByText(/good to see you/);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    unmount();

    render(<OnboardingChat chrome="none" intent="ongoing" />);
    await screen.findByText(/good to see you/);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
