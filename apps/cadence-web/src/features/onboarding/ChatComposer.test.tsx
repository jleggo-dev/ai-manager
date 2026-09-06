import { fireEvent, render, screen } from '@testing-library/react';
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

    // Still in the DOM — an unmount here is what aborted recognition.
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    created.slice(recognizersBefore).forEach((r) => expect(r.abort).not.toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  /**
   * The second bug, found on device: mounted is not the same as reachable. The mic used to be
   * CSS-hidden whenever the field had text, so you could dictate exactly once — stop talking and
   * your own words hid the button, fix a misheard word by hand and it hid, type first and it was
   * never there. In an app whose promise is that you can just talk to it, that is the worst
   * possible moment for the mic to leave.
   */
  it('keeps the mic REACHABLE once there is text, not just mounted', () => {
    const { container } = render(
      <ChatComposer
        value="a sentence I typed"
        onChange={noop}
        onSend={noop}
        streaming={false}
        showDisclaimer={false}
      />,
    );
    const slot = container.querySelector('.mic-slot');
    expect(slot).toBeInTheDocument();
    expect(slot?.className).not.toMatch(/is-hidden/);
    // Both affordances coexist: say more, or send what is there.
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('can start a SECOND dictation after the first was stopped', () => {
    render(<ChatComposer value="" onChange={noop} onSend={noop} streaming={false} showDisclaimer={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(created).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }));
    expect(created[0]!.stop).toHaveBeenCalled();
    // A stopped session is detached, so a late final cannot rewrite the field behind the user.
    expect(created[0]!.onresult).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(created).toHaveLength(2);
    expect(created[1]!.start).toHaveBeenCalled();
  });

  it('appends a second dictation to what is already there rather than replacing it', () => {
    let text = 'already typed';
    const onChange = vi.fn((v: string) => {
      text = v;
    });
    const { rerender } = render(
      <ChatComposer value={text} onChange={onChange} onSend={noop} streaming={false} showDisclaimer={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    created[0]!.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'and this too' } }],
    });
    expect(onChange).toHaveBeenCalledWith('already typed and this too');
    rerender(<ChatComposer value={text} onChange={onChange} onSend={noop} streaming={false} showDisclaimer={false} />);
    expect(text).toBe('already typed and this too');
  });

  it('offers the mic and no send button on an empty field', () => {
    render(<ChatComposer value="" onChange={noop} onSend={noop} streaming={false} showDisclaimer={false} />);
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('locks everything while the coach is replying', () => {
    render(<ChatComposer value="hi" onChange={noop} onSend={noop} streaming showDisclaimer={false} />);
    expect(screen.getByPlaceholderText(/coach is replying/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument();
  });

  /**
   * "I mistyped something and want to pause" — the composer used to show a dead arrow and make you
   * watch an answer to the wrong question arrive before you could fix it.
   */
  it('offers a live Stop while she is replying, not a dead arrow', () => {
    const onStop = vi.fn();
    render(<ChatComposer value="hi" onChange={noop} onSend={noop} streaming showDisclaimer={false} onStop={onStop} />);

    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText(/tap stop to interrupt/)).toBeDisabled();
  });

  it('disables Stop when the caller offers no way to stop', () => {
    render(<ChatComposer value="hi" onChange={noop} onSend={noop} streaming showDisclaimer={false} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });

  /**
   * The third bug found on device, and the one that proves the composer must never trust a
   * measurement it took while it had no box. MainTabs keeps the coach MOUNTED behind
   * `display: none` so an in-flight reply survives a tab switch, and the app lands on Plan — so
   * the composer's first measurement is always taken hidden. jsdom reports `scrollHeight` as 0 for
   * everything, which is that condition exactly. Stamping the 0 collapsed the field to its padding
   * and put a clipped caret in the corner (owner, 2026-08-16). The hook's own suite covers the
   * measuring; this pins that ChatComposer is actually wired to it.
   */
  it('never stamps a zero height on the field when it is measured while hidden', () => {
    const { container } = render(
      <ChatComposer value="" onChange={noop} onSend={noop} streaming={false} showDisclaimer={false} />,
    );
    expect(container.querySelector('textarea')!.style.height).not.toBe('0px');
  });
});
