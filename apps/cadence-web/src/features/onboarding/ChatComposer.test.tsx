import { render, screen } from '@testing-library/react';
import { ChatComposer } from './ChatComposer.tsx';

vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => <span>face</span> }));

/**
 * A fake WebKit recognizer, so the real MicButton renders (it returns null when dictation is
 * unavailable, which is what jsdom reports by default).
 */
class FakeRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
}
let created: FakeRecognition[] = [];

beforeEach(() => {
  created = [];
  vi.stubGlobal(
    'webkitSpeechRecognition',
    class {
      constructor() {
        const r = new FakeRecognition();
        created.push(r);
        return r as unknown as typeof FakeRecognition.prototype;
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const noop = () => {};

/**
 * The regression: mic and Send used to be the two branches of one ternary, so the first dictated
 * word made the field non-empty, React UNMOUNTED MicButton, and its cleanup called abort() —
 * which also throws away the pending final result. Dictation killed itself after one word.
 */
describe('ChatComposer', () => {
  it('keeps the mic mounted once there is text, so dictation cannot abort itself', () => {
    const { rerender } = render(
      <ChatComposer value="" onChange={noop} onSend={noop} streaming={false} showDisclaimer={false} />,
    );
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    const recognizersBefore = created.length;

    // The first dictated word lands: the field is now non-empty.
    rerender(<ChatComposer value="hello" onChange={noop} onSend={noop} streaming={false} showDisclaimer={false} />);

    // Still in the DOM — hidden, not torn down. An unmount here is what aborted recognition.
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    created.slice(recognizersBefore).forEach((r) => expect(r.abort).not.toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('offers the mic and no send button on an empty field', () => {
    render(<ChatComposer value="" onChange={noop} onSend={noop} streaming={false} showDisclaimer={false} />);
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('locks everything while Cadence is replying', () => {
    render(<ChatComposer value="hi" onChange={noop} onSend={noop} streaming showDisclaimer={false} />);
    expect(screen.getByPlaceholderText('Cadence is replying…')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument();
  });
});
